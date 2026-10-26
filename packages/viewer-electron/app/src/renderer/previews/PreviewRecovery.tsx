import { useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { renamedSibling } from '../../domain/previews/recovery';
import { NameDialog } from '../ui/primitives';

export function PreviewRecovery({
  path,
  entry,
  retry,
  locate,
  detail,
}: {
  path: string;
  entry?: FileEntry;
  detail?: string;
  retry(): void;
  locate?(entry: FileEntry): Promise<void> | void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  return (
    <div className="preview-recovery" role="status">
      {detail && <span>{detail} This view keeps the last loaded version.</span>}
      <div className="preview-recovery-actions">
        <button onClick={retry}>Check again</button>
        {locate && <button onClick={() => setChoosing(true)}>Locate file…</button>}
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
                      'No unique renamed file was found in this folder. Use Locate file to choose its new path.',
                    );
                  const latest = await window.viewer.stat(found.path);
                  if (latest.identity !== entry.identity)
                    throw new Error('The found file changed. Check again.');
                  await locate(latest);
                })
                .catch((error) => setProblem(String(error.message || error)))
                .finally(() => setBusy(false));
            }}
          >
            Find renamed file
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
          title="Locate file"
          label="File path"
          initial={path}
          maxLength={32768}
          action="Open"
          onClose={() => setChoosing(false)}
          onSubmit={async (file) => {
            const target = await window.viewer.stat(file);
            if (target.kind !== 'file') throw new Error('Choose a regular file.');
            await locate(target);
          }}
        />
      )}
    </div>
  );
}
