import { useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import {
  optimizationOptionsSchema,
  optimizationRecipeSchema,
} from '../../domain/operations/optimization';
import type { OptimizationOptions, OptimizationPreset } from '../../domain/operations/optimization';
import { pdfEmailPreset, type PDFExportPreset } from '../../domain/operations/export-presets';
import { formatOptimizationSize } from '../../domain/operations/optimization';
import { errorMessage } from '../../domain/errors';
import { Dialog, Loading } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { getState, receiveSettings, report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { useOptimizationSession } from './useOptimizationSession';
import { OptimizationComparison } from './OptimizationComparison';
import { OptimizationResults } from './OptimizationResults';
import { OptimizationNumberField } from './OptimizationNumberField';
import './optimization.css';

const presets = [
  { value: 'balanced', label: 'Balanced · high quality' },
  { value: 'small', label: 'Smaller · stronger compression' },
  { value: 'lossless', label: 'Lossless · keep image pixels' },
];
/** Common ancestry is displayed and explicitly selected, never stored in a recipe. */
export function optimizationRoot(files: readonly FileEntry[]): string | undefined {
  let root = files[0]?.parent;
  while (
    root &&
    files.some((file) => file.parent !== root && !file.parent.startsWith(root + '/'))
  ) {
    root = root.slice(0, root.lastIndexOf('/'));
  }
  return root && root !== '/' ? root : undefined;
}
export function OptimizeDialog({
  files,
  paneID,
  onClose,
  initial,
}: {
  files: FileEntry[];
  paneID?: string;
  onClose(): void;
  initial?: PDFExportPreset;
}) {
  const workspace = useWorkspace();
  const allJobs = useViewer((state) => state.jobs);
  const recipes = useViewer((state) => state.settings.settings.optimizationRecipes);
  const session = useOptimizationSession(files);
  const [options, setOptions] = useState<OptimizationOptions>(() =>
    initial
      ? { preset: pdfEmailPreset.preset, pdfImages: { maximum: pdfEmailPreset.maximum } }
      : { preset: 'balanced' },
  );
  const [recipeID, setRecipeID] = useState('');
  const [recipeName, setRecipeName] = useState('');
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const root = optimizationRoot(files);
  const [preserveFolders, setPreserveFolders] = useState(
    !!root && files.some((file) => file.parent !== root),
  );
  const [folder, setFolder] = useState(root ?? files[0]!.parent);
  const [unit, setUnit] = useState(
    files.some((file) => file.extension === 'pdf') ? 1_000_000 : 1000,
  );
  const jobs = session.jobs.flatMap((id) => {
    const job = allJobs.find((value) => value.id === id);
    return job ? [job] : [];
  });
  const running = jobs.some((job) => ['queued', 'running', 'collision'].includes(job.status));
  const working = session.busy || running;
  const validation = optimizationOptionsSchema.safeParse(options);
  const selected = session.rows.filter((row) => row.selected && !row.exported);
  const prepared = session.rows.filter((row) => row.candidate).length;
  const saved = jobs
    .flatMap((job) => job.completed)
    .reduce(
      (sum, item) =>
        sum + (item.optimized ? Math.max(0, (item.inputBytes ?? 0) - (item.outputBytes ?? 0)) : 0),
      0,
    );
  const update = (patch: Partial<OptimizationOptions>) => {
    session.reset();
    setOptions((value) => ({ ...value, ...patch }));
    setLocalError('');
  };
  const chooseRecipe = (id: string) => {
    const recipe = recipes.find((value) => value.id === id);
    if (!recipe) return;
    session.reset();
    setRecipeID(id);
    setRecipeName(recipe.name);
    setOptions(recipe.options);
    setPreserveFolders(recipe.preserveFolders && !!root);
    setLocalError('');
  };
  const saveRecipe = async (remove = false) => {
    setRecipeBusy(true);
    setLocalError('');
    try {
      const snapshot = getState().settings;
      const next = snapshot.settings.optimizationRecipes.filter((recipe) => recipe.id !== recipeID);
      const id = recipeID || crypto.randomUUID();
      if (!remove)
        next.push(
          optimizationRecipeSchema.parse({ id, name: recipeName, options, preserveFolders }),
        );
      const value = await window.viewer.settingsPatch(
        [{ path: 'settings.optimizationRecipes', value: next }],
        snapshot.revision,
      );
      receiveSettings(value);
      setRecipeID(remove ? '' : id);
      if (remove) setRecipeName('');
    } catch (reason) {
      setLocalError(errorMessage(reason));
    } finally {
      setRecipeBusy(false);
    }
  };
  const reviewCandidate =
    session.comparison &&
    session.rows.find((row) => row.candidate?.id === session.comparison?.id)?.candidate;
  const error =
    localError ||
    session.error ||
    (!validation.success
      ? 'Check the target size, quality and dimensions before preparing files.'
      : '');
  return (
    <Dialog
      wide
      title={`Optimize ${files.length === 1 ? files[0]!.name : `${files.length} files`}`}
      onClose={onClose}
      className="optimize-dialog"
    >
      <div className="optimization-content">
        <div className="dialog-body optimize-options">
          <div className="optimization-main-options">
            <label>
              Preset
              <ChoiceButton
                label="Optimization preset"
                value={options.preset}
                choices={presets}
                disabled={working}
                onChoose={(value) =>
                  update({
                    preset: value as OptimizationPreset,
                    ...(value === 'lossless' ? { maximum: undefined, pdfImages: undefined } : {}),
                  })
                }
              />
            </label>
            <label className="optimization-target-toggle">
              <input
                type="checkbox"
                disabled={working}
                checked={!!options.targetSize}
                onChange={(event) =>
                  update({
                    targetSize: event.target.checked
                      ? { bytes: unit * (unit === 1000 ? 500 : 2), minimumQuality: 60 }
                      : undefined,
                  })
                }
              />
              Target size per file
            </label>
            {options.targetSize && (
              <div className="optimization-target">
                <OptimizationNumberField
                  aria-label="Target size"
                  min={1024 / unit}
                  max={(256 * 1024 * 1024) / unit}
                  step="any"
                  disabled={working}
                  value={options.targetSize.bytes / unit}
                  onValue={(value) =>
                    update({
                      targetSize: {
                        ...options.targetSize!,
                        bytes: Math.round(value * unit),
                      },
                    })
                  }
                />
                <ChoiceButton
                  label="Target size unit"
                  value={String(unit)}
                  choices={[
                    { value: '1000', label: 'kB' },
                    { value: '1000000', label: 'MB' },
                  ]}
                  disabled={working}
                  onChoose={(value) => setUnit(Number(value))}
                />
              </div>
            )}
          </div>
          <p className="muted">
            Prepare candidates, compare quality, then save selected smaller copies. Originals stay
            intact.
          </p>
          <details className="optimization-advanced">
            <summary>Quality and dimensions</summary>
            <div className="optimization-advanced-fields">
              {options.targetSize && options.preset !== 'lossless' && (
                <label>
                  Minimum quality
                  <OptimizationNumberField
                    aria-label="Minimum optimization quality"
                    min={20}
                    max={95}
                    disabled={working}
                    value={options.targetSize.minimumQuality}
                    onValue={(value) =>
                      update({
                        targetSize: {
                          ...options.targetSize!,
                          minimumQuality: value,
                        },
                      })
                    }
                  />
                  <span className="muted">Viewer stops here even if the target is missed.</span>
                </label>
              )}
              {files.some((file) => file.extension.toLowerCase() !== 'pdf') && (
                <label>
                  <input
                    type="checkbox"
                    disabled={working || options.preset === 'lossless'}
                    checked={options.maximum !== undefined}
                    onChange={(event) =>
                      update({ maximum: event.target.checked ? 2048 : undefined })
                    }
                  />
                  Limit image dimensions
                  {options.maximum !== undefined && (
                    <>
                      <OptimizationNumberField
                        aria-label="Maximum image edge"
                        min={64}
                        max={32768}
                        disabled={working}
                        value={options.maximum}
                        onValue={(value) => update({ maximum: value })}
                      />
                      <span>px longest edge</span>
                    </>
                  )}
                </label>
              )}
              {files.some((file) => file.extension.toLowerCase() === 'pdf') && (
                <label>
                  <input
                    type="checkbox"
                    disabled={working || options.preset === 'lossless'}
                    aria-label="Recompress scanned images"
                    checked={!!options.pdfImages}
                    onChange={(event) =>
                      update({ pdfImages: event.target.checked ? { maximum: 2400 } : undefined })
                    }
                  />
                  Recompress scanned images
                  {options.pdfImages && (
                    <>
                      <OptimizationNumberField
                        aria-label="PDF maximum image edge"
                        min={256}
                        max={8192}
                        disabled={working}
                        value={options.pdfImages.maximum}
                        onValue={(value) => update({ pdfImages: { maximum: value } })}
                      />
                      <span>px longest edge</span>
                    </>
                  )}
                </label>
              )}
              <p className="muted">
                PDFs retain text, vectors and page sizes. Signed PDFs stay unchanged. Scanned-image
                compression supports compatible JPEG scans. Lossless targets never lower image
                quality.
              </p>
            </div>
          </details>
          <details className="optimization-recipes">
            <summary>
              Saved batch recipes
              {recipeID ? ` · ${recipes.find((recipe) => recipe.id === recipeID)?.name ?? ''}` : ''}
            </summary>
            <div className="optimization-recipe-fields">
              {!!recipes.length && (
                <ChoiceButton
                  label="Saved optimization recipe"
                  value={recipeID}
                  disabled={working || recipeBusy}
                  choices={recipes.map((recipe) => ({ value: recipe.id, label: recipe.name }))}
                  onChoose={chooseRecipe}
                />
              )}
              <input
                aria-label="Optimization recipe name"
                placeholder="Recipe name"
                value={recipeName}
                maxLength={100}
                disabled={working || recipeBusy}
                onChange={(event) => setRecipeName(event.target.value)}
              />
              <button
                disabled={working || recipeBusy || !recipeName.trim() || !validation.success}
                onClick={() => void saveRecipe()}
              >
                {recipeID ? 'Update recipe' : 'Save recipe'}
              </button>
              {recipeID && (
                <>
                  <button
                    disabled={working || recipeBusy}
                    onClick={() => {
                      setRecipeID('');
                      setRecipeName('');
                    }}
                  >
                    Save as new
                  </button>
                  <button disabled={working || recipeBusy} onClick={() => void saveRecipe(true)}>
                    Remove recipe
                  </button>
                </>
              )}
              <p className="muted">
                Recipes remember compression, target size and folder layout. File locations stay
                with this batch.
              </p>
            </div>
          </details>
          <label>
            Save smaller copies in
            <div className="media-destination">
              <input
                aria-label="Optimization output folder"
                value={folder}
                disabled={working}
                onChange={(event) => setFolder(event.target.value)}
              />
              <button
                disabled={working}
                onClick={() =>
                  void window.viewer
                    .chooseFolder(folder)
                    .then((value) => {
                      if (value) setFolder(value);
                    })
                    .catch(report)
                }
              >
                Choose…
              </button>
            </div>
          </label>
          {root && (
            <label className="optimization-preserve">
              <input
                type="checkbox"
                disabled={working}
                checked={preserveFolders}
                onChange={(event) => setPreserveFolders(event.target.checked)}
              />
              Keep folders relative to {root.split('/').at(-1)}
            </label>
          )}
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <OptimizationResults
          session={session}
          jobs={jobs}
          options={validation.success ? validation.data : undefined}
          sourceRoot={preserveFolders ? root : undefined}
          working={working}
          onOpen={(file) => {
            void workspace
              .openPath(file, { paneID, linked: !!paneID, activate: true })
              .then(onClose)
              .catch(report);
          }}
        />
        {!!session.reviewing && <Loading label="Opening before and after…" />}
        {session.comparison && reviewCandidate && (
          <OptimizationComparison
            key={session.comparison.id}
            review={session.comparison}
            candidate={reviewCandidate}
            onClose={session.clearReview}
          />
        )}
      </div>
      <footer>
        <span className="muted" role="status">
          {prepared} of {files.length} prepared
          {saved ? ` · ${formatOptimizationSize(saved)} saved` : ''}
          {selected.length ? ` · ${selected.length} selected` : ''}
        </span>
        <span className="toolbar-spacer" />
        <button onClick={onClose}>Close</button>
        {working ? (
          <button onClick={() => void session.cancel().catch(report)}>Cancel optimization</button>
        ) : (
          <>
            <button
              disabled={!validation.success || prepared === files.length}
              onClick={() => {
                if (validation.success) void session.prepare(validation.data);
              }}
            >
              {prepared ? 'Prepare remaining' : 'Prepare candidates'}
            </button>
            <button
              className="primary"
              disabled={!selected.length || !folder.trim()}
              onClick={() => void session.save(folder, preserveFolders ? root : undefined)}
            >
              Save {selected.length || ''} smaller {selected.length === 1 ? 'copy' : 'copies'}
            </button>
          </>
        )}
      </footer>
    </Dialog>
  );
}
