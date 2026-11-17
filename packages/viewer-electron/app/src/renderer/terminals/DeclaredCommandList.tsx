import { useEffect, useState } from 'react';
import type { DeclaredCommand } from '../../domain/terminals/declared-commands';
import { declaredCommandLimits } from '../../domain/terminals/declared-commands';
import { definitionRunReason, useTerminalAuthority } from './start-authority';
import './declared-commands.css';

export function DeclaredCommandList({
  directory,
  disabled = false,
  onPick,
}: {
  directory: string;
  disabled?: boolean;
  onPick(line: string): void;
}) {
  const [commands, setCommands] = useState<DeclaredCommand[]>([]);
  useTerminalAuthority();
  const blocked = !!definitionRunReason([]);
  useEffect(() => {
    setCommands([]);
    if (blocked) return;
    let current = true;
    // A late disk result must not rearrange the picker after the person has begun using it.
    const timer = setTimeout(() => {
      current = false;
    }, 300);
    void Promise.resolve()
      .then(() => window.viewer.declaredCommands(directory))
      .then((value) => {
        if (current) setCommands(value.commands);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [directory, blocked]);
  if (blocked || !commands.length) return null;
  const ordered = commands.slice().sort((a, b) => Number(!!b.lastRun) - Number(!!a.lastRun));
  const groups = new Map<string, DeclaredCommand[]>();
  for (const command of ordered.slice(0, declaredCommandLimits.rows)) {
    const label = command.relativeSource ?? command.file;
    const group = groups.get(label) ?? [];
    group.push(command);
    groups.set(label, group);
  }
  return (
    <section className="declared-commands" aria-label="Declared commands">
      {[...groups].map(([file, items]) => (
        <section key={file} aria-label={file}>
          <h3>{file}</h3>
          {items.map((item) => (
            <button
              type="button"
              className="declared-command-row"
              key={item.source + ':' + item.name}
              disabled={disabled}
              onClick={() => onPick(item.line)}
            >
              <span className="declared-command-line">
                <code>{item.line}</code>
                {item.lastRun ? <span className="muted">Last run</span> : null}
              </span>
              {item.detail ? <span className="muted">{item.detail}</span> : null}
              {item.context ? <span className="muted">{item.context}</span> : null}
            </button>
          ))}
        </section>
      ))}
    </section>
  );
}
