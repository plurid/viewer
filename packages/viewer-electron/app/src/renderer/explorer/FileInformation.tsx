import type { FileEntry } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import { Dialog } from '../ui/primitives';

export function FileInformation({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  return (
    <Dialog title="File information" onClose={onClose}>
      <dl className="file-information">
        {entries.map((entry) => (
          <div key={entry.path}>
            <dt>{entry.name}</dt>
            <dd>{entry.path}</dd>
            <dt>Kind</dt>
            <dd>
              {entry.kind === 'symlink' ? 'Symbolic link' : entry.directory ? 'Folder' : entry.mime}
            </dd>
            <dt>Size</dt>
            <dd>
              {entry.directory
                ? '—'
                : `${formatBytes(entry.size)} (${entry.size.toLocaleString()} bytes)`}
            </dd>
            <dt>Modified</dt>
            <dd>{entry.modified ? new Date(entry.modified).toLocaleString() : 'Unavailable'}</dd>
            <dt>Created</dt>
            <dd>{entry.created ? new Date(entry.created).toLocaleString() : 'Unavailable'}</dd>
            {entry.linkTarget && (
              <>
                <dt>Target</dt>
                <dd>{entry.linkTarget}</dd>
              </>
            )}
            {entry.error && <dd className="error">{entry.error}</dd>}
          </div>
        ))}
      </dl>
      <footer>
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
