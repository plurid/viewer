import { useEffect, useId, useRef, useState } from 'react';
import { gitCommitMessageLimit } from '../../domain/comparison/git-actions';
import { errorMessage } from '../../domain/errors';
import { Dialog, PathField } from '../ui/primitives';
import './commit-dialog.css';

export interface CommitDialogProps {
  directory: string;
  onSubmit(message: string): Promise<void> | void;
  onClose(): void;
}

/** A transient message prompt; the caller retains the captured repository target. */
export function CommitDialog({ directory, onSubmit, onClose }: CommitDialogProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const hintID = useId();
  const errorID = useId();
  const valid = !!message.trim() && message.length <= gitCommitMessageLimit;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const close = () => {
    if (!pending.current) onClose();
  };
  const submit = async () => {
    if (pending.current || !valid) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit(message);
      if (mounted.current) onClose();
    } catch (value) {
      if (mounted.current) setError(errorMessage(value));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Dialog title="Commit staged changes" className="git-commit-dialog" onClose={close}>
      <form
        aria-label="Git commit"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="git-commit-folder">
          <strong>Current folder</strong>
          <PathField path={directory} />
        </p>
        <p className="git-commit-hint" id={hintID}>
          Commit only changes already staged in the repository containing this folder.
        </p>
        <label className="field-label">
          Commit message
          <textarea
            data-autofocus
            rows={6}
            required
            maxLength={gitCommitMessageLimit}
            aria-describedby={[hintID, error ? errorID : undefined].filter(Boolean).join(' ')}
            value={message}
            disabled={busy}
            onChange={(event) => {
              setMessage(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        {error && (
          <p className="error" role="alert" id={errorID}>
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !valid}
            aria-keyshortcuts="Meta+Enter Control+Enter"
          >
            {busy ? 'Starting…' : 'Commit staged changes'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
