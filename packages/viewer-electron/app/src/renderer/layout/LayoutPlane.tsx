import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { LayoutPane } from '../../domain/contracts';
import { layoutModes } from '../../domain/layout/modes';
import type { LayoutMode } from '../../domain/layout/modes';
import type { LayoutFormat, LayoutTransform } from '../../domain/layout/plan';
import { isProblem, planLayout } from '../../domain/layout/planner';
import type { LayoutResult } from '../../domain/layout/planner';
import { layoutCandidates, layoutFingerprint } from '../../domain/layout/candidates';
import { suggestLayout } from '../../domain/layout/suggest';
import type { ModeSuggestion } from '../../domain/layout/suggest';
import { changeMode, defaultLayoutSettings, isPlannedMode } from '../../domain/layout/settings';
import type { LayoutSettings, PlannedMode } from '../../domain/layout/settings';
import { layoutFileName, layoutName } from '../../domain/layout/names';
import { isScreenSize } from '../../domain/layout/pages';
import { sourceLimits } from '../../domain/layout/sources';
import type { LayoutSource } from '../../domain/layout/sources';
import { sourceVersion } from '../../domain/files/inspection';
import { isActiveJob } from '../../domain/operations/jobs';
import { baseName } from '../../domain/workspaces/planes';
import { errorMessage } from '../../domain/errors';
import { Empty, IconButton, Loading } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { report, updatePane, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { NestingPanel } from './nesting/NestingPanel';
import { LayoutSheet } from './LayoutSheet';
import type { SheetSource } from './LayoutSheet';
import { LayoutOptions } from './LayoutOptions';
import { LayoutPictures } from './pictures';
import { readSelection } from './measure';
import type { ReadSelection } from './measure';
import './layout.css';

export const modeLabels: Record<LayoutMode, string> = {
  collage: 'Collage',
  'contact-sheet': 'Contact sheet',
  'n-up': 'N-up',
  booklet: 'Booklet',
  'step-repeat': 'Step and repeat',
  poster: 'Poster',
  nesting: 'Nesting',
};
const formatLabels: Record<LayoutFormat, string> = { pdf: 'PDF', png: 'PNG', jpeg: 'JPEG' };

/** The plan's sources as the preview reads them, by its source numbers. */
function sheetSources(result: LayoutResult, sources: readonly LayoutSource[]): SheetSource[] {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  return result.sources.map((path) => {
    const source = byPath.get(path)!;
    return {
      path,
      size: (page) =>
        source.kind === 'image'
          ? { width: source.width, height: source.height }
          : source.pages[(page ?? 1) - 1]!,
    };
  });
}

/** The modes this selection can use: the suggested ones first, as suggested. */
function usableModes(read: ReadSelection, suggested: readonly ModeSuggestion[]): LayoutMode[] {
  const defaults = defaultLayoutSettings();
  const usable = layoutModes.filter((mode) =>
    mode === 'nesting'
      ? read.drawings.length > 0
      : read.sources.length > 0 && !isProblem(planLayout(defaults, read.sources, mode)),
  );
  const first = suggested.map((item) => item.mode).filter((mode) => usable.includes(mode));
  return [...first, ...usable.filter((mode) => !first.includes(mode))];
}

/** Starts from the suggestion, in the plane's saved mode if it has one, with the best layout. */
function initialSettings(
  read: ReadSelection,
  suggested: LayoutSettings,
  modes: readonly LayoutMode[],
  saved?: LayoutMode,
): LayoutSettings {
  const mode = saved && modes.includes(saved) ? saved : (modes[0] ?? suggested.mode);
  const settings = { ...suggested, mode };
  if (!isPlannedMode(mode)) return settings;
  const [best] = layoutCandidates(settings, read.sources, mode, 1);
  return best ? { ...best.settings, mode } : settings;
}

export default function LayoutPlane({ pane }: { pane: LayoutPane }) {
  const workspace = useWorkspace();
  const jobs = useViewer((state) => state.jobs);
  const [read, setRead] = useState<ReadSelection>();
  const [progress, setProgress] = useState({ done: 0, total: pane.sources.length });
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [suggested, setSuggested] = useState<ModeSuggestion[]>([]);
  const [settings, setSettings] = useState<LayoutSettings>();
  const [sheet, setSheet] = useState(0);
  const [customName, setCustomName] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [ids, setIDs] = useState<string[]>([]);
  const key = pane.sources.join('\n');
  useEffect(() => {
    const abort = new AbortController();
    let found: ReadSelection | undefined;
    setRead(undefined);
    setFailure('');
    setSettings(undefined);
    void readSelection(key.split('\n'), abort.signal, (done, total) => {
      if (!abort.signal.aborted) setProgress({ done, total });
    })
      .then((value) => {
        found = value;
        if (abort.signal.aborted) {
          value.documents.forEach((document) => document.close());
          return;
        }
        const suggestion = suggestLayout({
          sources: value.sources,
          drawings: value.drawings.length,
        });
        const modes = usableModes(value, suggestion.modes);
        setRead(value);
        setSuggested(suggestion.modes);
        setSettings(initialSettings(value, suggestion.settings, modes, pane.mode));
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setFailure(errorMessage(reason));
      });
    return () => {
      abort.abort();
      found?.documents.forEach((document) => document.close());
    };
    // the saved mode applies when the files are read, not each time it is saved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const pictures = useMemo(
    () => read && new LayoutPictures(read.documents, read.thumbnails),
    [read],
  );
  useEffect(() => () => pictures?.close(), [pictures]);
  const modes = useMemo(() => (read ? usableModes(read, suggested) : []), [read, suggested]);
  const mode = settings?.mode;
  const planned = mode && isPlannedMode(mode) ? mode : undefined;
  const result = useMemo(
    () => (settings && read && planned ? planLayout(settings, read.sources, planned) : undefined),
    [settings, read, planned],
  );
  // candidates follow a moment behind typing, so the main preview stays quick
  const deferred = useDeferredValue(settings);
  const candidates = useMemo(
    () =>
      deferred && read && deferred.mode !== 'nesting' && isPlannedMode(deferred.mode)
        ? layoutCandidates(deferred, read.sources, deferred.mode)
        : [],
    [deferred, read],
  );
  const plan = result && !isProblem(result) ? result : undefined;
  const current = useMemo(() => (plan ? layoutFingerprint(plan) : ''), [plan]);
  const pages = plan?.plan.pages.length ?? 0;
  const shown = Math.min(sheet, Math.max(0, pages - 1));
  const exports = jobs.filter((job) => ids.includes(job.id));
  const working = saving || exports.some((job) => isActiveJob(job));

  if (failure)
    return (
      <Empty icon="warning" title="The files could not be read" detail={failure}>
        <button onClick={() => setAttempt((value) => value + 1)}>Try again</button>
      </Empty>
    );
  if (!read || !settings || !pictures)
    return (
      <div className="layout-plane">
        <Loading
          label={
            progress.total > 1
              ? `Reading ${progress.done} of ${progress.total} files…`
              : 'Reading the file…'
          }
        />
      </div>
    );
  if (!modes.length)
    return (
      <Empty
        icon="image"
        title="Nothing to lay out"
        detail="Lay out photos, PDFs or DXF parts. The selected files are none of these."
      />
    );

  const choose = (next: LayoutSettings) => {
    setSettings(next);
    setSaveError('');
  };
  const switchMode = (next: LayoutMode) => {
    if (next === settings.mode) return;
    setCustomName(undefined);
    setSheet(0);
    choose(initialSettings(read, { ...settings }, [next]));
    updatePane(pane.id, { mode: next });
  };
  const name =
    customName ??
    (planned && plan ? layoutName(settings, planned, read.sources, plan.perSheet) : '');
  const save = async (value: LayoutResult) => {
    setSaving(true);
    setSaveError('');
    try {
      const id = await window.viewer.operate({
        kind: 'convert',
        sources: value.sources,
        destination: pane.path,
        name: layoutFileName(name, value.plan.format),
        transform: value.plan,
        expectedSources: value.sources.map((path) => ({
          path,
          version: sourceVersion(read.entries.get(path)!),
        })),
      });
      setIDs((previous) => [...previous, id]);
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };
  const heavy =
    !!plan &&
    plan.sources.reduce((total, path) => {
      const entry = read.entries.get(path);
      return total + (entry?.extension.toLowerCase() === 'pdf' ? entry.size : 0);
    }, 0) > sourceLimits.pdfs;
  const reasonOf = (value: LayoutMode) => suggested.find((item) => item.mode === value)?.reason;

  return (
    <section className="layout-plane" aria-label="Layout">
      <div className="preview-toolbar layout-toolbar">
        <div className="layout-modes" role="group" aria-label="Layout mode">
          {modes.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === settings.mode}
              title={reasonOf(value)}
              onClick={() => switchMode(value)}
            >
              {modeLabels[value]}
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <span className="muted" role="status">
          {plan?.summary ?? (settings.mode === 'nesting' ? reasonOf('nesting') : '')}
        </span>
      </div>
      {read.skipped.length > 0 && (
        <p className="layout-notice">
          Left out: {read.skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}
        </p>
      )}
      {settings.mode === 'nesting' ? (
        <div className="layout-nesting">
          <NestingPanel files={read.drawings} />
        </div>
      ) : (
        <div className="layout-body">
          <div className="layout-main">
            {result && isProblem(result) ? (
              <Empty icon="warning" title="This layout cannot be made" detail={result.problem} />
            ) : (
              plan && (
                <>
                  <div className="layout-stage">
                    <LayoutSheet
                      page={plan.plan.pages[shown]!}
                      format={plan.plan.format}
                      sources={sheetSources(plan, read.sources)}
                      pictures={pictures}
                      size={plan.plan.pages[shown]!.items.length > 60 ? 'small' : 'large'}
                      label={`Page ${shown + 1} of ${pages}`}
                    />
                  </div>
                  {pages > 1 && (
                    <div className="layout-pager">
                      <IconButton
                        icon="left"
                        label="Previous page"
                        disabled={shown === 0}
                        onClick={() => setSheet(shown - 1)}
                      />
                      <span>
                        Page {shown + 1} of {pages}
                      </span>
                      <IconButton
                        icon="right"
                        label="Next page"
                        disabled={shown >= pages - 1}
                        onClick={() => setSheet(shown + 1)}
                      />
                    </div>
                  )}
                </>
              )
            )}
            {candidates.length > 1 && (
              <div className="layout-candidates" role="group" aria-label="Suggested layouts">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className="layout-candidate"
                    aria-pressed={candidate.fingerprint === current}
                    onClick={() => {
                      setSheet(0);
                      choose({ ...candidate.settings, mode: settings.mode });
                    }}
                  >
                    <span className="layout-candidate-sheet" aria-hidden="true">
                      <LayoutSheet
                        page={candidate.result.plan.pages[0]!}
                        format={candidate.result.plan.format}
                        sources={sheetSources(candidate.result, read.sources)}
                        pictures={pictures}
                        size="small"
                        label={candidate.label}
                      />
                    </span>
                    <strong>{candidate.label}</strong>
                    <span className="muted">{candidate.result.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <aside className="layout-options" aria-label="Layout options">
            <div className="layout-options-choices">
              {planned && (
                <LayoutOptions
                  settings={settings}
                  mode={planned}
                  sources={read.sources}
                  onChange={choose}
                />
              )}
              {planned && plan && (
                <Output
                  settings={settings}
                  mode={planned}
                  plan={plan}
                  name={name}
                  folder={pane.path}
                  onName={setCustomName}
                  onChange={choose}
                />
              )}
            </div>
            {/* outside the scrolling choices, so Save stays in view however many a mode has */}
            <div className="layout-save">
              {plan && heavy && (
                <p className="error">
                  The PDFs in this layout are over 512 MB together. Choose fewer.
                </p>
              )}
              {plan && (
                <button
                  className="primary"
                  disabled={working || heavy || !name.trim()}
                  onClick={() => void save(plan)}
                >
                  {working ? 'Saving…' : `Save ${formatLabels[plan.plan.format]}`}
                </button>
              )}
              {saveError && (
                <p className="error" role="alert">
                  {saveError}
                </p>
              )}
              {exports.map((job) => (
                <div className="layout-job" key={job.id} aria-live="polite">
                  <span role="status">
                    {isActiveJob(job)
                      ? `${Math.round((job.progress ?? 0) * 100)}% · ${job.detail || 'Saving…'}`
                      : job.status === 'completed'
                        ? 'Saved'
                        : job.status}
                    {job.errors[0] ? ` · ${job.errors[0].message}` : ''}
                  </span>
                  {isActiveJob(job) && (
                    <button onClick={() => void window.viewer.cancelJob(job.id).catch(report)}>
                      Cancel
                    </button>
                  )}
                  {job.completed
                    .filter((item) => item.destination)
                    .map((item) => (
                      <button
                        key={item.destination}
                        onClick={() =>
                          void workspace
                            .openPath(item.destination!, {
                              paneID: pane.id,
                              linked: true,
                              activate: true,
                            })
                            .catch(report)
                        }
                      >
                        Open {baseName(item.destination!)}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function Output({
  settings,
  mode,
  plan,
  name,
  folder,
  onName,
  onChange,
}: {
  settings: LayoutSettings;
  mode: PlannedMode;
  plan: LayoutResult;
  name: string;
  folder: string;
  onName(name: string): void;
  onChange(settings: LayoutSettings): void;
}) {
  const format: LayoutTransform['format'] = plan.plan.format;
  const page = settings[mode].page;
  const paper = page.size !== 'fit' && !isScreenSize(page.size);
  return (
    <section className="layout-section" aria-label="Save">
      <div className="layout-field">
        <span>Save as</span>
        <div className="layout-segmented" role="group" aria-label="Format">
          {(['pdf', 'png', 'jpeg'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === format}
              disabled={!plan.formats.includes(value)}
              title={
                plan.formats.includes(value)
                  ? undefined
                  : 'An image holds one page without PDF pages.'
              }
              onClick={() => onChange(changeMode(settings, mode, { format: value }))}
            >
              {formatLabels[value]}
            </button>
          ))}
        </div>
      </div>
      {format !== 'pdf' && paper && (
        <label className="layout-field">
          <span>Resolution</span>
          <ChoiceButton
            label="Resolution"
            value={String(settings.dpi)}
            choices={[150, 300, 600].map((dpi) => ({ value: String(dpi), label: `${dpi} dpi` }))}
            onChoose={(value) => onChange({ ...settings, dpi: Number(value) })}
          />
        </label>
      )}
      {plan.note && <p className="layout-note">{plan.note}</p>}
      <label className="layout-field">
        <span>Name</span>
        <input
          aria-label="Output name"
          value={name}
          maxLength={200}
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <p className="muted layout-folder" title={folder}>
        Saves a new file in {baseName(folder)}, beside the originals.
      </p>
    </section>
  );
}
