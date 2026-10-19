import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CustomAction, TerminalProfile } from '../domain/automation';
import { DocumentStore } from './document-store';

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Summary = { title: string; detail: string };
const environment = (env: Record<string, string>) =>
  Object.entries(env).map(([key, value]) => `${key}=${value}`);

/** The private record of a confirmed terminal profile: what it runs, not what it is called. */
export const terminalConfirmation = ({
  executable,
  args,
  env,
}: Pick<TerminalProfile, 'executable' | 'args' | 'env'>): string =>
  fingerprint({ terminal: { executable, args, env } });
/** The built-in login profile starts the person's own shell, which configuration cannot change. */
export function loginShell(profile: TerminalProfile): boolean {
  return (
    !profile.executable &&
    !Object.keys(profile.env).length &&
    profile.args.every((arg) => arg === '-l')
  );
}
/** Describes exactly what a terminal profile starts, for a native confirmation. */
export function terminalSummary(profile: TerminalProfile): Summary {
  const command = [...environment(profile.env), profile.executable || '$SHELL', ...profile.args];
  return {
    title: `Start terminal profile “${profile.name}” for the first time?`,
    detail: command.join(' ').slice(0, 6000),
  };
}

/** Describes exactly what a custom action runs, for a native confirmation. */
export function executionSummary(action: CustomAction): { title: string; detail: string } {
  const executor = action.executor;
  const detail =
    executor.kind === 'shell'
      ? `${executor.executable} runs this script${executor.perItem ? ' once per selected item' : ''}:\n\n${executor.script}`
      : executor.kind === 'executable'
        ? `${[executor.executable, ...executor.args].join(' ')}${executor.perItem ? '\n\nRuns once per selected item.' : ''}`
        : `Terminal profile ${JSON.stringify(executor)}`;
  return { title: `Run “${action.name}” for the first time?`, detail: detail.slice(0, 6000) };
}

/**
 * Remembers, outside editable configuration, which exact executors the person has
 * confirmed. A new or changed shell or executable action, terminal profile, tmux
 * program or terminal application asks natively once, so an imported or externally
 * edited configuration cannot run code silently.
 */
export class ExecutionConfirmations {
  private store: DocumentStore<string[]>;
  private confirmed?: Promise<Set<string>>;
  private asking = new Map<string, Promise<void>>();
  constructor(
    directory: string,
    private ask: (summary: { title: string; detail: string }) => Promise<boolean>,
  ) {
    this.store = new DocumentStore(path.join(directory, 'confirmed-actions-v1.json'), (value) =>
      z
        .array(z.string().regex(/^[0-9a-f]{64}$/))
        .max(1000)
        .parse(value),
    );
  }
  private load(): Promise<Set<string>> {
    return (this.confirmed ??= this.store
      .load()
      .then((values) => new Set(values ?? []))
      .catch((error: unknown) => {
        this.confirmed = undefined;
        throw error;
      }));
  }
  async require(action: CustomAction): Promise<void> {
    if (action.executor.kind !== 'shell' && action.executor.kind !== 'executable') return;
    await this.confirm(fingerprint(action.executor), executionSummary(action));
  }
  async requireTerminal(profile: TerminalProfile): Promise<void> {
    if (loginShell(profile)) return;
    await this.confirm(terminalConfirmation(profile), terminalSummary(profile));
  }
  /** tmux on the search path with its default server and no extra environment is the default. */
  async requireTmux(
    executable: string,
    socket: string,
    env: Record<string, string>,
  ): Promise<void> {
    if (executable === 'tmux' && !socket && !Object.keys(env).length) return;
    await this.confirm(fingerprint({ tmux: { executable, socket, env } }), {
      title: 'Use this tmux program for the first time?',
      detail: [...environment(env), executable, ...(socket ? ['-S', socket] : [])]
        .join(' ')
        .slice(0, 6000),
    });
  }
  /** An application chosen by path, rather than one of the discovered terminal apps. */
  async requireTerminalApplication(application: string): Promise<void> {
    await this.confirm(fingerprint({ application }), {
      title: 'Open terminals with this application for the first time?',
      detail: application.slice(0, 6000),
    });
  }
  private async confirm(key: string, summary: Summary): Promise<void> {
    const confirmed = await this.load();
    if (confirmed.has(key)) return;
    // One dialog per executor, even when the action is started twice quickly.
    let pending = this.asking.get(key);
    if (!pending) {
      pending = (async () => {
        if (!(await this.ask(summary)))
          throw new Error('The action was not confirmed. Nothing was run.');
        confirmed.add(key);
        await this.store.save([...confirmed].slice(-1000));
      })().finally(() => this.asking.delete(key));
      this.asking.set(key, pending);
    }
    await pending;
  }
}
