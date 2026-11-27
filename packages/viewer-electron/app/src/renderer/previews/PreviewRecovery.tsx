import { previewProblem } from './preview-problem';
import { sameCapturedItem } from '../../domain/files/entries';
import { useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { renamedSibling } from '../../domain/previews/recovery';
import { NameDialog, tryAgainLabel } from '../ui/primitives';

export function PreviewRecovery({
  path,
  entry,
  retry,
  locate,
  detail,
  inline = false,
}: {
  path: string;
  entry?: FileEntry;
  detail?: string;
  /** Inside an empty state, its actions join that state's row: no bar of its own. */
  inline?: boolean;
  retry(): void;
  locate?(entry: FileEntry): Promise<void> | void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  return (
    <div className={inline ? 'preview-recovery-inline' : 'preview-recovery'} role="status">
      {detail && <span>{detail} This view keeps the last loaded version.</span>}
      <div className="preview-recovery-actions">
        <button onClick={retry}>{tryAgainLabel}</button>
        {locate && <button onClick={() => setChoosing(true)}>Locate File…</button>}
        {locate && entry?.identity && (
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem('');
              void window.viewer
                .list(entry.parent)
                .then(async (listing) => {
                  const found = renamedSibling(entry, listing.entries);
                  if (!found)
                    throw new Error(
                      'Viewer found no single renamed file in this folder. Use Locate File… to choose it.',
                    );
                  const latest = await window.viewer.stat(found.path);
                  if (!sameCapturedItem(latest, entry))
                    throw new Error('The file changed as Viewer found it. Try again.');
                  await locate(latest);
                })
                .catch((error) =>
                  setProblem(
                    previewProblem(error, "Viewer couldn't find the renamed file in this folder.", [
                      'Viewer found no single renamed file in this folder. Use Locate File… to choose it.',
                      'The file changed as Viewer found it. Try again.',
                    ]),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Find Renamed File
          </button>
        )}
      </div>
      {problem && (
        <span className="error" role="alert">
          {problem}
        </span>
      )}
      {choosing && locate && (
        <NameDialog
          title="Locate File"
          label="File path"
          initial={path}
          maxLength={32768}
          action="Open"
          onClose={() => setChoosing(false)}
          onSubmit={async (file) => {
            const target = await window.viewer.stat(file);
            if (target.kind !== 'file') throw new Error('Choose a file, not a folder or alias.');
            await locate(target);
          }}
        />
      )}
    </div>
  );
}
