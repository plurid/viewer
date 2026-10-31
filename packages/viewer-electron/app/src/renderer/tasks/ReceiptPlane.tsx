import { useEffect, useState } from 'react';
import type { ReceiptPane as Record } from '../../domain/contracts';
import type { CommandReceipt } from '../../domain/automation/receipts';
import { receiptMarkdown } from '../../domain/automation/receipts';
import { errorMessage } from '../../domain/errors';
import { CopyButton, Empty, Loading, PathField } from '../ui/primitives';
import './tasks.css';
export function receiptOutcome(receipt: Pick<CommandReceipt, 'status' | 'exitCode'>): string {
  return receipt.status === 'running'
    ? 'Running'
    : receipt.status === 'interrupted'
      ? 'Interrupted'
      : receipt.status === 'cancelled'
        ? 'Stopped'
        : receipt.exitCode !== undefined
          ? 'Exited ' + receipt.exitCode
          : receipt.status === 'failed'
            ? 'Failed to finish'
            : 'Finished';
}
export default function ReceiptPlane({ pane, active }: { pane: Record; active: boolean }) {
  const [receipt, setReceipt] = useState<CommandReceipt>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const read = () =>
      window.viewer
        .receipts({ kind: 'read', id: pane.receiptID })
        .then((reply) => {
          if (live && reply.kind === 'receipt') {
            setReceipt(reply.receipt);
            setError('');
          }
        })
        .catch((value) => {
          if (live) setError(errorMessage(value));
        });
    void read();
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'receipt-changed' && event.id === pane.receiptID) void read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [active, pane.receiptID, attempt]);
  const exportReceipt = async () => {
    if (!receipt) return;
    const id = crypto.randomUUID();
    const text = receiptMarkdown(receipt);
    try {
      await window.viewer.textSaveAs(text, 'Command receipt.md', id);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      await window.viewer.textEditEnd(id);
    }
  };
  if (!receipt)
    return error ? (
      <Empty title="Command receipt unavailable" detail={error}>
        <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </Empty>
    ) : (
      <Loading label="Reading command receipt…" />
    );
  return (
    <article className="receipt-plane">
      <header>
        <strong>{receiptOutcome(receipt)}</strong>
        <span className="muted">
          {new Date(receipt.started).toLocaleString()}
          {receipt.ended !== undefined
            ? ' · ' + ((receipt.ended - receipt.started) / 1000).toFixed(1) + 's'
            : ''}
        </span>
        <span className="toolbar-spacer" />
        {receipt.status === 'running' && (
          <button
            onClick={() =>
              void window.viewer
                .executionCancel(receipt.id)
                .catch((value) => setError(errorMessage(value)))
            }
          >
            Stop
          </button>
        )}
        <CopyButton
          appearance="text"
          label="Copy output"
          copy={{ text: receipt.output }}
          onError={(value) => setError(errorMessage(value))}
        />
        <button onClick={() => void exportReceipt()}>Export Markdown…</button>
      </header>
      <div className="receipt-scroll">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {receipt.error && <p className="inline-warning">{receipt.error}</p>}
        <dl>
          <dt>Folder</dt>
          <dd>
            <PathField
              path={receipt.directory}
              onError={(value) => setError(errorMessage(value))}
            />
          </dd>
          <dt>Observed folder</dt>
          <dd>{receipt.folderIdentity ?? 'Identity unavailable'} · before launch</dd>
        </dl>
        <p className="muted">
          Stored privately. This records the process outcome; file contents and test results are not
          inferred.
        </p>
        <h2>Command</h2>
        <pre>{receipt.command}</pre>
        <h2>Output</h2>
        {receipt.truncated && <p className="inline-warning">Showing the last 256 KiB.</p>}
        <pre className="receipt-output">{receipt.output || 'No output was recorded.'}</pre>
      </div>
    </article>
  );
}
