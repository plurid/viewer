import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CommandContext } from '../commands/registry';
import { useWorkspace } from '../workspace/context';
import { CopyButton, IconButton, PathField } from '../ui/primitives';
import { report, useViewer } from '../state/store';
import {
  captureCommandTarget,
  editQuickCommand,
  hideQuickCommand,
  quickCommandSnapshot,
  runQuickCommand,
  showQuickCommand,
  subscribeQuickCommand,
} from './quick-command';
import './run-command.css';

export function QuickCommand({
  context,
  initialQuery,
  onBack,
  onClose,
}: {
  context: CommandContext;
  initialQuery: string;
  onBack(): void;
  onClose(): void;
}) {
  const workspace = useWorkspace();
  const [target] = useState(() => captureCommandTarget(context, workspace));
  const input = useRef<HTMLTextAreaElement>(null);
  const current = useSyncExternalStore(subscribeQuickCommand, quickCommandSnapshot);
  const profile = useViewer((state) => {
    const terminals = state.settings.settings.terminals;
    return terminals.profiles.find((profile) => profile.id === terminals.profileID)?.name;
  });
  useEffect(() => {
    showQuickCommand(target, initialQuery);
    input.current?.focus();
    return hideQuickCommand;
  }, [target, initialQuery]);
  const { task, pending, error } = current;
  const busy = pending || task?.status === 'running';
  const directory = (current.target ?? target).directory;
  return (
    <form
      className="quick-command"
      onSubmit={(event) => {
        event.preventDefault();
        void runQuickCommand();
      }}
    >
      <div className="quick-command-context">
        <IconButton icon="left" label="Back to commands" onClick={onBack} />
        <PathField path={directory} />
        <span className="muted">{profile}</span>
      </div>
      <textarea
        ref={input}
        data-autofocus
        aria-label="Shell command"
        placeholder="Enter a shell command…"
        value={current.draft}
        onChange={(event) => editQuickCommand(event.target.value)}
        rows={2}
        maxLength={16000}
        spellCheck={false}
        readOnly={busy}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) void runQuickCommand();
          } else if (event.key === 'Backspace' && !current.draft && !busy) {
            event.preventDefault();
            onBack();
          }
        }}
      />
      <div className="quick-command-actions">
        <span className="muted">Enter to run · Shift+Enter for a new line</span>
        {task?.status === 'running' ? (
          <button
            type="button"
            onClick={() => void window.viewer.executionCancel(task.id).catch(report)}
          >
            Stop
          </button>
        ) : (
          <button type="submit" disabled={busy || !current.draft.trim()}>
            {pending ? 'Starting…' : 'Run'}
          </button>
        )}
      </div>
      <p className="quick-command-note muted">Use a terminal for interactive programs.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {task && (
        <section className="quick-command-output" aria-label="Command output">
          <div className="quick-command-actions">
            <span role="status">
              {task.status}
              {task.exitCode !== undefined ? ` · exit ${task.exitCode}` : ''}
            </span>
            <div>
              {!!task.output && (
                <CopyButton appearance="text" label="Copy output" copy={{ text: task.output }} />
              )}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  workspace.openReceipt(task.id, task.directory);
                }}
              >
                Open receipt
              </button>
            </div>
          </div>
          {task.directory && task.directory !== directory && <PathField path={task.directory} />}
          {task.error && (
            <p role="alert" className="error">
              {task.error}
            </p>
          )}
          {task.truncated && <p className="muted">Showing the last 256 KiB of output.</p>}
          <pre tabIndex={0}>
            {task.output || (task.status === 'running' ? 'Waiting for output…' : 'No output.')}
          </pre>
        </section>
      )}
    </form>
  );
}
