import { useState } from 'react';
import type { JournalExportPreview } from '../../domain/journal/events';
import { formatBytes } from '../../domain/files/entries';
import { errorMessage } from '../../domain/errors';
import { Dialog } from '../ui/primitives';
import { plural } from '../../domain/plural';

export function ExportDialog({
  preview,
  onClose,
}: {
  preview: JournalExportPreview;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title="Export Journal"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
      className="journal-export"
    >
      <p>
        {plural(preview.count, 'event')} · {formatBytes(preview.bytes)} · JSON
      </p>
      <p>
        This is exactly what is saved. It holds workspace, plane and task IDs, and no file names,
        paths, chats or terminal output.
      </p>
      {preview.truncated && (
        <p>Only the newest 2,000 events. Narrow the filters to export others.</p>
      )}
      <textarea
        aria-label="Journal export preview"
        value={preview.text}
        readOnly
        spellCheck={false}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              if (await window.viewer.journalExport(preview.id)) onClose();
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Save Export…'}
        </button>
      </footer>
    </Dialog>
  );
}
