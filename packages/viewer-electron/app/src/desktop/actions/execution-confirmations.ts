import path from 'node:path';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { CustomAction, TerminalProfile } from '../../domain/automation/actions';
import { DocumentStore } from '../persistence/document-store';

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Summary = { title: string; detail: string };
export interface DefinitionCommandConfirmation {
  key: string;
  cwd: string;
  profile: TerminalProfile;
  command: string;
  workspaceName: string;
}

export type DefinitionCommandApproval =
  { kind: 'approved'; fingerprints: string[] } | { kind: 'declined' };

interface DefinitionApprovalQueue {
  asking: Map<string, Promise<DefinitionCommandApproval>>;
  tail: Promise<unknown>;
  closed: boolean;
  waiting: Set<() => void>;
}

function untilWindowCloses<T>(
  queue: DefinitionApprovalQueue,
  work: Promise<T>,
  declined: T,
): Promise<T> {
  if (queue.closed) {
    void work.catch(() => {});
    return Promise.resolve(declined);
  }
  return new Promise((resolve, reject) => {
    const close = () => {
      queue.waiting.delete(close);
      resolve(declined);
    };
    queue.waiting.add(close);
    void work.then(
      (value) => {
        queue.waiting.delete(close);
        resolve(value);
      },
      (error: unknown) => {
        queue.waiting.delete(close);
        reject(error);
      },
    );
  });
}

/** The caller supplies the same canonical folder that the native review displays. */
export function definitionCommandFingerprint(item: DefinitionCommandConfirmation): string {
  const { executable, args, env } = item.profile;
  return fingerprint({
    definitionCommand: {
      key: item.key,
      cwd: item.cwd,
      profile: { executable, args, env },
      command: item.command,
    },
  });
}

export async function definitionCommandConfirmation(
  item: DefinitionCommandConfirmation,
): Promise<string> {
  return definitionCommandFingerprint({ ...item, cwd: await realpath(item.cwd) });
}
const environment = (env: Record<string, string>) =>
  Object.entries(env).map(([key, value]) => `${key}=${value}`);

function reviewLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Z}\u005c]/gu, (character) => {
    if (character === ' ') return character;
    if (character === '\\') return '\\\\';
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    const code = character.codePointAt(0)!;
    return code > 0xffff ? `\\u{${code.toString(16)}}` : '\\u' + code.toString(16).padStart(4, '0');
  });
}

const definitionReviewNote =
  'Viewer asks again if a command, its folder or its terminal profile changes.';
const definitionReviewLimit = 6000;

function programArgument(value: string): string {
  const visible = reviewLine(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? visible
    : "'" + visible.replace(/'/g, "'\\''") + "'";
}

/** Shell quoting preserves argument boundaries in both native profile reviews. */
function terminalProgram(profile: TerminalProfile): string {
  return [
    ...Object.entries(profile.env).map(
      ([key, value]) => `${reviewLine(key)}=${programArgument(value)}`,
    ),
    profile.executable ? programArgument(profile.executable) : '$SHELL',
    ...profile.args.map(programArgument),
  ].join(' ');
}

function wrappedReviewLine(label: string, value: string, limit: number): string[] {
  const lines: string[] = [];
  let remaining = value;
  do {
    const prefix = `${label}${lines.length ? ' (continued)' : ''}: `;
    let end = Math.min(remaining.length, limit - prefix.length);
    // A page boundary must not turn a visible Unicode character into two surrogates.
    if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--;
    lines.push(prefix + remaining.slice(0, end));
    remaining = remaining.slice(end);
  } while (remaining);
  return lines;
}

function definitionReviews(items: readonly DefinitionCommandConfirmation[]): string[] {
  const budget = definitionReviewLimit - definitionReviewNote.length - 2;
  const pages: string[] = [];
  let page = '';
  for (const [index, item] of items.entries()) {
    const profile = item.profile;
    const header = `Command ${index + 1} of ${items.length}`;
    const lineLimit = budget - header.length - 1;
    const lines = [
      ...wrappedReviewLine('Folder', reviewLine(item.cwd), lineLimit),
      `Terminal profile: ${reviewLine(profile.name)}`,
      ...(!loginShell(profile)
        ? wrappedReviewLine('Program', terminalProgram(profile), lineLimit)
        : []),
      `Command: ${item.command}`,
    ];
    const block = [header, ...lines].join('\n');
    if (page && page.length + block.length + 2 > budget) {
      pages.push(page);
      page = '';
    }
    for (const [lineIndex, line] of lines.entries()) {
      let prefix = lineIndex === 0 ? (page ? '\n\n' : '') + header + '\n' : '\n';
      if (page.length + prefix.length + line.length > budget) {
        if (page) pages.push(page);
        page = '';
      }
      if (!page) prefix = header + '\n';
      page += prefix + line;
    }
  }
  if (page) pages.push(page);
  return pages.map((detail) => detail + '\n\n' + definitionReviewNote);
}

/** The private record of a confirmed terminal profile: what it runs, not what it is called. */
export const terminalConfirmation = ({
  executable,
  args,
  env,
}: Pick<TerminalProfile, 'executable' | 'args' | 'env'>): string =>
  fingerprint({ terminal: { executable, args, env } });
/** The built-in login profile starts the person's own shell, which configuration cannot change. */
function loginShell(profile: TerminalProfile): boolean {
  return (
    !profile.executable &&
    !Object.keys(profile.env).length &&
    profile.args.every((arg) => arg === '-l')
  );
}
/** Describes exactly what a terminal profile starts, for a native confirmation. */
function terminalSummary(profile: TerminalProfile): Summary {
  return {
    title: `Start terminal profile “${reviewLine(profile.name)}” for the first time?`,
    detail: terminalProgram(profile).slice(0, 6000),
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
  private definitionWindows = new WeakMap<BrowserWindow, DefinitionApprovalQueue>();
  private definitionDefault?: DefinitionApprovalQueue;
  private recording: Promise<void> = Promise.resolve();
  private persisted: string[] = [];
  private recencyTimer?: ReturnType<typeof setTimeout>;
  constructor(
    directory: string,
    private ask: (summary: Summary, window?: BrowserWindow) => Promise<boolean>,
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
      .then((values) => {
        this.persisted = values ?? [];
        return new Set(this.persisted);
      })
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
  requireDefinitionCommand(
    item: DefinitionCommandConfirmation,
    window?: BrowserWindow,
  ): Promise<DefinitionCommandApproval> {
    return this.requireDefinitionCommands([item], window);
  }
  requireDefinitionCommands(
    items: readonly DefinitionCommandConfirmation[],
    window?: BrowserWindow,
  ): Promise<DefinitionCommandApproval> {
    const queue = this.definitionQueue(window);
    if (queue.closed) return Promise.resolve({ kind: 'declined' });
    const snapshots = structuredClone(items);
    const batch = JSON.stringify(snapshots.map(definitionCommandFingerprint).sort());
    const existing = queue.asking.get(batch);
    if (existing) return existing;
    const work = queue.tail
      .catch(() => {})
      .then(() => this.confirmDefinitionCommands(snapshots, queue, window));
    const pending = untilWindowCloses(queue, work, { kind: 'declined' }).finally(() =>
      queue.asking.delete(batch),
    );
    queue.asking.set(batch, pending);
    queue.tail = pending;
    return pending;
  }

  private definitionQueue(window?: BrowserWindow): DefinitionApprovalQueue {
    const existing = window ? this.definitionWindows.get(window) : this.definitionDefault;
    if (existing) return existing;
    const queue: DefinitionApprovalQueue = {
      asking: new Map(),
      tail: Promise.resolve(),
      closed: window?.isDestroyed?.() ?? false,
      waiting: new Set(),
    };
    window?.once?.('closed', () => {
      queue.closed = true;
      for (const close of queue.waiting) close();
    });
    if (window) this.definitionWindows.set(window, queue);
    else this.definitionDefault = queue;
    return queue;
  }

  private async confirmDefinitionCommands(
    items: readonly DefinitionCommandConfirmation[],
    queue: DefinitionApprovalQueue,
    window?: BrowserWindow,
  ): Promise<DefinitionCommandApproval> {
    if (queue.closed) return { kind: 'declined' };
    const confirmed = await this.load();
    const keyed = await Promise.all(
      items.map(async (item) => {
        const snapshot = { ...item, cwd: await realpath(item.cwd) };
        return [definitionCommandFingerprint(snapshot), snapshot] as const;
      }),
    );
    if (queue.closed) return { kind: 'declined' };
    const unapproved = [...new Map(keyed)].filter(([key]) => !confirmed.has(key));
    if (unapproved.length) {
      const workspaceName = reviewLine(unapproved[0]![1].workspaceName);
      const pages = definitionReviews(unapproved.map(([, item]) => item));
      const count = unapproved.length;
      for (const [index, detail] of pages.entries()) {
        const title = `Run ${count === 1 ? '1 command' : `${count} commands`} in “${workspaceName}”?`;
        if (
          !(await untilWindowCloses(
            queue,
            this.ask(
              {
                title: title + (pages.length > 1 ? ` (${index + 1} of ${pages.length})` : ''),
                detail,
              },
              window,
            ),
            false,
          )) ||
          queue.closed
        )
          return { kind: 'declined' };
      }
    }
    const fingerprints = [...new Map(keyed).keys()];
    if (queue.closed) return { kind: 'declined' };
    if (unapproved.length) await this.record(fingerprints, confirmed, () => !queue.closed);
    else this.refresh(fingerprints, confirmed);
    if (queue.closed) return { kind: 'declined' };
    return { kind: 'approved', fingerprints };
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
    if (confirmed.has(key)) {
      this.refresh([key], confirmed);
      return;
    }
    // One dialog per executor, even when the action is started twice quickly.
    let pending = this.asking.get(key);
    if (!pending) {
      pending = (async () => {
        if (!(await this.ask(summary)))
          throw new Error('The action was not confirmed. Nothing was run.');
        await this.record([key], confirmed);
      })().finally(() => this.asking.delete(key));
      this.asking.set(key, pending);
    }
    await pending;
  }
  private refresh(keys: readonly string[], confirmed: Set<string>): void {
    const next = this.usedKeys(keys, confirmed);
    const current = [...confirmed];
    if (next.length === current.length && next.every((key, index) => key === current[index]))
      return;
    confirmed.clear();
    for (const key of next) confirmed.add(key);
    this.scheduleRecency(confirmed);
  }

  private usedKeys(keys: readonly string[], confirmed: Set<string>): string[] {
    const used = new Set(keys);
    return [...[...confirmed].filter((key) => !used.has(key)), ...used].slice(-1000);
  }

  private scheduleRecency(confirmed: Set<string>): void {
    clearTimeout(this.recencyTimer);
    this.recencyTimer = undefined;
    if (this.sameRecord([...confirmed])) return;
    // Recency is an eviction hint. A read-only disk must not revoke an existing approval.
    this.recencyTimer = setTimeout(() => {
      this.recencyTimer = undefined;
      const task = this.recording
        .catch(() => {})
        .then(async () => {
          const next = [...confirmed];
          if (this.sameRecord(next)) return;
          await this.store.save(next);
          this.persisted = next;
        });
      this.recording = task.catch(() => {});
    }, 250);
    this.recencyTimer.unref?.();
  }

  private sameRecord(next: readonly string[]): boolean {
    return (
      next.length === this.persisted.length &&
      next.every((key, index) => key === this.persisted[index])
    );
  }

  private record(
    keys: readonly string[],
    confirmed: Set<string>,
    valid: () => boolean = () => true,
  ): Promise<void> {
    const task = this.recording
      .catch(() => {})
      .then(async () => {
        if (!valid()) return;
        if (keys.every((key) => confirmed.has(key))) {
          this.refresh(keys, confirmed);
          return;
        }
        const next = this.usedKeys(keys, confirmed);
        await this.store.save(next);
        this.persisted = next;
        const current = this.usedKeys(keys, confirmed);
        confirmed.clear();
        for (const key of current) confirmed.add(key);
        this.scheduleRecency(confirmed);
      });
    this.recording = task.catch(() => {});
    return task;
  }
}
