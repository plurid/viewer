import { useState } from 'react';
import type { JournalExportPreview } from '../../domain/journal/events';
import { formatBytes } from '../../domain/files/entries';
import { errorMessage } from '../../domain/errors';
import { Dialog } from '../ui/primitives';

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
        {preview.count.toLocaleString()} events · {formatBytes(preview.bytes)} · JSON
      </p>
      <p>
        Review the exact export below. It includes internal workspace, plane and task IDs. File
        names, paths, Chat content and terminal output are excluded.
      </p>
      {preview.truncated && (
        <p>
          Limited to the newest 2,000 matching events. Narrow the filters to export a smaller range.
        </p>
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
          {busy ? 'Saving…' : 'Save export…'}
        </button>
      </footer>
    </Dialog>
  );
}
