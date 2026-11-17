import { useId, useRef, useState } from 'react';
import { errorMessage } from '../../domain/errors';
import { Button, Empty, PathField } from '../ui/primitives';
import './definition-commands.css';

type PanelState = 'available' | 'changed' | 'unavailable' | 'checking';

interface DefinitionStartPanelProps {
  plane: number;
  command?: string;
  cwd: string;
  disabledReason?: string;
  pending?: boolean;
  failure?: string;
  state?: PanelState;
  onReset?(): void;
  onRun(): void | Promise<unknown>;
  onShellOnly(): void | Promise<unknown>;
}

export function DefinitionStartPanel({
  plane,
  command,
  cwd,
  disabledReason,
  pending = false,
  failure,
  state = command ? 'available' : 'unavailable',
  onReset,
  onRun,
  onShellOnly,
}: DefinitionStartPanelProps) {
  const reasonID = useId();
  const commandID = useId();
  const folderID = useId();
  const busy = useRef(false);
  const [starting, setStarting] = useState(false);
  const [actionFailure, setFailure] = useState('');
  const characters = Array.from(command ?? '');
  const runLabel = characters.length > 80 ? characters.slice(0, 77).join('') + '…' : command;
  async function start(action: () => void | Promise<unknown>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setStarting(true);
    setFailure('');
    try {
      await action();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      busy.current = false;
      setStarting(false);
    }
  }
  return (
    <section
      className="definition-start-panel"
      aria-label={`Command terminal ${plane + 1}: ${runLabel || (state === 'changed' ? 'Terminal changed' : 'Command unavailable')}`}
      aria-describedby={[command ? commandID : '', folderID].filter(Boolean).join(' ')}
      aria-busy={starting || pending}
    >
      <Empty
        icon="terminal"
        title={
          state === 'changed'
            ? 'Terminal changed'
            : state === 'checking'
              ? 'Checking definition…'
              : command
                ? 'Command not started'
                : 'Command unavailable'
        }
      >
        {state === 'changed' ? <p role="status">This terminal changed in the definition.</p> : null}
        {command ? (
          <code id={commandID} className="definition-command-line">
            {command}
          </code>
        ) : null}
        <div id={folderID}>
          <PathField path={cwd} />
        </div>
        {disabledReason ? (
          <p id={reasonID} role="status">
            {disabledReason}
          </p>
        ) : null}
        {failure || actionFailure ? (
          <p className="definition-command-error" role="alert">
            {failure || actionFailure}
          </p>
        ) : null}
        <div className="empty-actions">
          {state === 'changed' ? (
            <Button
              variant="secondary"
              disabled={starting || pending || Boolean(disabledReason)}
              onClick={onReset}
            >
              Reset to definition…
            </Button>
          ) : (
            <Button
              variant="primary"
              className="definition-run-command"
              disabled={!command || Boolean(disabledReason) || starting || pending}
              aria-describedby={[command ? commandID : '', disabledReason ? reasonID : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                void start(onRun);
              }}
            >
              <span>{command ? `Run ${runLabel}` : 'Run'}</span>
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={starting || pending}
            onClick={() => {
              void start(onShellOnly);
            }}
          >
            Shell only
          </Button>
        </div>
      </Empty>
    </section>
  );
}
