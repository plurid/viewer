import { useId } from 'react';
import { Button } from '../ui/primitives';
import './definition-commands-notice.css';

interface DefinitionCommandsNoticeProps {
  count: number;
  disabledReason?: string;
  onRunAll(): void;
  onNotNow(): void;
}

export function DefinitionCommandsNotice({
  count,
  disabledReason,
  onRunAll,
  onNotNow,
}: DefinitionCommandsNoticeProps) {
  const reasonID = useId();
  if (count < 1) return null;
  const commands = count === 1 ? '1 command' : `${count} commands`;
  return (
    <section className="bar definition-commands-notice" aria-label="Workspace commands">
      <span role="status">{commands} in this workspace</span>
      <Button
        variant="secondary"
        disabled={Boolean(disabledReason)}
        aria-describedby={disabledReason ? reasonID : undefined}
        onClick={onRunAll}
      >
        Run all {commands}
      </Button>
      <Button variant="secondary" onClick={onNotNow}>
        Not now
      </Button>
      {disabledReason ? (
        <p id={reasonID} role="status">
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}
