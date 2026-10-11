import type { FileEntry } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import { Dialog } from '../ui/primitives';
import { SelectionSize, calculateSize } from './sizes';
import { report } from '../state/store';

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
              {entry.directory ? (
                <SelectionSize entries={[entry]} />
              ) : (
                `${formatBytes(entry.size)} (${entry.size.toLocaleString()} bytes)`
              )}
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
        {entries.some((entry) => entry.directory) && (
          <button
            onClick={() => {
              void calculateSize(entries).catch(report);
            }}
          >
            Calculate Size
          </button>
        )}
        {entries.length > 1 && <SelectionSize entries={entries} />}
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
