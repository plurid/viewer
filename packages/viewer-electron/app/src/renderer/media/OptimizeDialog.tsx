import { useRef, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { optimizationPlan, type OptimizationPreset } from '../../domain/operations/optimization';
import { sourceVersion } from '../../domain/files/inspection';
import { formatBytes } from '../../domain/files/entries';
import { Dialog } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import './optimization.css';
export function OptimizeDialog({
  files,
  paneID,
  onClose,
}: {
  files: FileEntry[];
  paneID?: string;
  onClose(): void;
}) {
  const workspace = useWorkspace(),
    allJobs = useViewer((state) => state.jobs);
  const [preset, setPreset] = useState<OptimizationPreset>('balanced'),
    [resize, setResize] = useState(false),
    [maximum, setMaximum] = useState(2048);
  const [folder, setFolder] = useState(files[0]!.parent),
    [ids, setIDs] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const jobs = allJobs.filter((job) => ids.includes(job.id)),
    working = busy || jobs.some((job) => ['queued', 'running', 'collision'].includes(job.status));
  const run = useRef({ cancelled: false, ids: [] as string[] });
  const cancel = async () => {
    run.current.cancelled = true;
    await Promise.all(run.current.ids.map((id) => window.viewer.cancelJob(id)));
  };
  const items = jobs.flatMap((job) => job.completed),
    saved = items.reduce(
      (total, item) =>
        total +
        (item.optimized ? Math.max(0, (item.inputBytes || 0) - (item.outputBytes || 0)) : 0),
      0,
    );
  const start = async () => {
    const current = { cancelled: false, ids: [] as string[] };
    run.current = current;
    setIDs([]);
    setBusy(true);
    setError('');
    const queued: string[] = [];
    try {
      const groups = new Map<string, FileEntry[]>();
      for (const file of files) {
        const key = JSON.stringify(optimizationPlan(file, preset, resize ? maximum : undefined));
        const group = groups.get(key) || [];
        group.push(file);
        groups.set(key, group);
      }
      for (const [key, group] of groups) {
        if (current.cancelled) break;
        const id = await window.viewer.operate({
          kind: 'convert',
          sources: group.map((file) => file.path),
          destination: folder,
          transform: JSON.parse(key),
          expectedSources: group.map((file) => ({
            path: file.path,
            version: sourceVersion(file),
          })),
        });
        queued.push(id);
        current.ids.push(id);
        setIDs([...queued]);
        if (current.cancelled) await window.viewer.cancelJob(id);
      }
    } catch (error) {
      setError(String((error as Error).message || error));
    } finally {
      setIDs(queued);
      setBusy(false);
    }
  };
  return (
    <Dialog
      wide
      title={`Optimize ${files.length === 1 ? files[0]!.name : `${files.length} files`}`}
      onClose={onClose}
      className="optimize-dialog"
    >
      <div className="dialog-body optimize-options">
        <label>
          Preset
          <ChoiceButton
            label="Optimization preset"
            value={preset}
            choices={[
              { value: 'balanced', label: 'Balanced · high quality, smaller files' },
              { value: 'small', label: 'Smaller · stronger image compression' },
              { value: 'lossless', label: 'Lossless · keep image pixels' },
            ]}
            onChoose={(value) => {
              setPreset(value as OptimizationPreset);
              if (value === 'lossless') setResize(false);
            }}
          />
        </label>
        <p className="muted">
          PDFs keep searchable text, vectors and page sizes. Signed PDFs stay unchanged. Image
          metadata keeps color and credit and removes GPS.
        </p>
        {files.some((file) => file.extension.toLowerCase() !== 'pdf') && (
          <div className="optimize-resize">
            <label>
              <input
                type="checkbox"
                checked={resize}
                disabled={preset === 'lossless'}
                onChange={(event) => setResize(event.target.checked)}
              />
              Limit image dimensions
            </label>
            <label>
              Longest edge
              <input
                aria-label="Maximum image edge"
                type="number"
                min={64}
                max={32768}
                disabled={!resize}
                value={maximum}
                onChange={(event) =>
                  setMaximum(Math.max(64, Math.min(32768, Number(event.target.value) || 2048)))
                }
              />
            </label>
            <span className="muted">px</span>
          </div>
        )}
        <label>
          Save smaller copies in
          <div className="media-destination">
            <input
              aria-label="Optimization output folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            />
            <button
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
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="optimize-results">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Original</th>
              <th>Optimized</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {files.slice(0, 100).map((file) => {
              const job = jobs.find((job) => job.sources.includes(file.path)),
                item = job?.completed.find((item) => item.source === file.path),
                failure = job?.errors.find((error) => error.path === file.path);
              return (
                <tr key={file.path}>
                  <td title={file.path}>{file.name}</td>
                  <td>{formatBytes(item?.inputBytes ?? file.size)}</td>
                  <td>{item?.optimized ? formatBytes(item.outputBytes!) : '—'}</td>
                  <td>
                    {failure ? (
                      <span className="error" title={failure.message}>
                        {failure.message}
                      </span>
                    ) : item ? (
                      item.optimized ? (
                        <>
                          <span className="optimize-savings">
                            {Math.round((1 - item.outputBytes! / item.inputBytes!) * 100)}% smaller
                          </span>
                          <button
                            onClick={() =>
                              void workspace
                                .openPath(item.destination!, {
                                  paneID,
                                  linked: !!paneID,
                                  activate: true,
                                })
                                .then(onClose)
                                .catch(report)
                            }
                          >
                            Open
                          </button>
                        </>
                      ) : (
                        'Already compact · original kept'
                      )
                    ) : job ? (
                      job.status === 'running' ? (
                        `${Math.round((job.progress || 0) * 100)}% · ${job.detail || 'Optimizing…'}`
                      ) : (
                        job.status
                      )
                    ) : (
                      'Ready'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {files.length > 100 && (
        <p className="muted optimize-limit">
          Showing the first 100 of {files.length} files. Every selected file is processed; full
          results remain in Recent file operations.
        </p>
      )}
      <footer>
        <span className="muted">
          {ids.length
            ? `${items.length} of ${files.length} processed · ${formatBytes(saved)} saved`
            : 'Originals stay intact. Results are saved only when smaller.'}
        </span>
        <span className="toolbar-spacer" />
        <button onClick={onClose}>Close</button>
        {working ? (
          <button onClick={() => void cancel().catch(report)}>Cancel optimization</button>
        ) : (
          <button
            className="primary"
            disabled={busy || !folder.trim()}
            onClick={() => void start()}
          >
            Optimize {files.length === 1 ? 'file' : `${files.length} files`}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
