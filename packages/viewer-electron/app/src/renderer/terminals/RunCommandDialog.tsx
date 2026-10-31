/* Existing Viewer command prompt: captured folder, explicit Run, background output. */
import { useRef, useState } from 'react';
import type { CapturedTarget } from '../../domain/automation/actions';
import { errorMessage } from '../../domain/errors';
import { Dialog, PathField } from '../ui/primitives';
import { attachCommandReceipt } from '../tasks/state';
import { report } from '../state/store';
import './run-command.css';

// Per-window memory only: shell commands can contain credentials.
let recentCommands: string[] = [];
export function RunCommandDialog({ target, onClose }: { target: CapturedTarget; onClose(): void }) {
  const [script, setScript] = useState('');
  const [recent, setRecent] = useState(recentCommands);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const submit = async () => {
    if (pending.current || !script.trim()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (saving) await window.viewer.commandDraft({ script, name: name.trim() || 'Run command' });
      else {
        const receiptID = await window.viewer.runCommand(script, target);
        try {
          attachCommandReceipt(target, {
            id: receiptID,
            title: script.trim().split('\n')[0]!.slice(0, 100),
            directory: target.directory,
          });
        } catch (value) {
          report(
            new Error(
              'The command started and its receipt is in Command history, but its task link could not be added: ' +
                errorMessage(value),
            ),
          );
        }
        recentCommands = [script, ...recentCommands.filter((value) => value !== script)].slice(
          0,
          20,
        );
      }
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={saving ? 'Save command as action' : 'Run command'}
      className="run-command-dialog"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-busy={busy}
      >
        <PathField className="run-command-folder" path={target.directory} />
        {saving && (
          <label className="field-label">
            Name
            <input
              aria-label="Action name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
            />
          </label>
        )}
        <label className="field-label">
          Command
          <textarea
            data-autofocus
            rows={4}
            maxLength={16000}
            spellCheck={false}
            disabled={busy}
            value={script}
            onChange={(event) => {
              setScript(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (
                !event.nativeEvent.isComposing &&
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <p className="muted">
          {saving
            ? 'Review and add this command in Settings.'
            : 'Shell syntax is supported. Commands and output are saved privately in Command history. Use a terminal for interactive programs.'}
        </p>
        {!!recent.length && !saving && (
          <section className="run-command-recent" aria-label="Recent commands">
            <div>
              <strong>Recent</strong>
              <button
                type="button"
                onClick={() => {
                  recentCommands = [];
                  setRecent([]);
                }}
              >
                Clear
              </button>
            </div>
            {recent.map((value) => (
              <button type="button" key={value} onClick={() => setScript(value)}>
                <code>{value}</code>
              </button>
            ))}
          </section>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            disabled={busy || !script.trim()}
            onClick={() => setSaving(!saving)}
          >
            {saving ? 'Back' : 'Save as action…'}
          </button>
          <span className="toolbar-spacer" />
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !script.trim()}>
            {busy ? 'Starting…' : saving ? 'Review in Settings' : 'Run'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
