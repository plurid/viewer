import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionCommandConfirmation } from '../src/desktop/actions/execution-confirmations';
import {
  ExecutionConfirmations,
  definitionCommandFingerprint,
} from '../src/desktop/actions/execution-confirmations';
import { DocumentStore } from '../src/desktop/persistence/document-store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let cwd: string;
let other: string;
const window = {} as BrowserWindow;

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-definition-approval-'));
  cwd = path.join(root, 'project');
  other = path.join(root, 'other');
  await Promise.all([mkdir(cwd), mkdir(other)]);
});
afterEach(async () => {
  await trashTemporary(root);
  vi.restoreAllMocks();
});

const command = (
  changes: Partial<DefinitionCommandConfirmation> = {},
): DefinitionCommandConfirmation => ({
  key: 'tools/sample',
  cwd,
  profile: { id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} },
  command: 'npm run dev',
  workspaceName: 'Sample',
  ...changes,
});

describe('workspace command approvals', () => {
  it('does not block an unrelated window behind an unanswered dialog', async () => {
    const firstWindow = new EventEmitter() as BrowserWindow;
    const otherWindow = new EventEmitter() as BrowserWindow;
    const ask = vi.fn((_summary: unknown, owner?: BrowserWindow) =>
      owner === firstWindow ? new Promise<boolean>(() => {}) : Promise.resolve(true),
    );
    const confirmations = new ExecutionConfirmations(root, ask);
    const first = confirmations.requireDefinitionCommand(command(), firstWindow);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    await expect(
      confirmations.requireDefinitionCommand(command({ command: 'npm test' }), otherWindow),
    ).resolves.toMatchObject({ kind: 'approved' });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]![1]).toBe(otherWindow);
    firstWindow.emit('closed');
    await expect(first).resolves.toEqual({ kind: 'declined' });
  });

  it('does not share an identical pending batch across different windows', async () => {
    const otherWindow = new EventEmitter() as BrowserWindow;
    const answers: ((answer: boolean) => void)[] = [];
    const ask = vi.fn(
      (_summary: unknown, _owner?: BrowserWindow) =>
        new Promise<boolean>((resolve) => answers.push(resolve)),
    );
    const confirmations = new ExecutionConfirmations(root, ask);
    const first = confirmations.requireDefinitionCommand(command(), window);
    const second = confirmations.requireDefinitionCommand(command(), otherWindow);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    answers[0]!(false);
    answers[1]!(false);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'declined' },
      { kind: 'declined' },
    ]);
  });

  it('declines active and queued approvals when their window closes, ignoring a late yes', async () => {
    const closedWindow = new EventEmitter() as BrowserWindow;
    let answer!: (answer: boolean) => void;
    const ask = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const confirmations = new ExecutionConfirmations(root, ask);
    const first = confirmations.requireDefinitionCommand(command(), closedWindow);
    const second = confirmations.requireDefinitionCommand(
      command({ command: 'npm test' }),
      closedWindow,
    );
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    closedWindow.emit('closed');
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'declined' },
      { kind: 'declined' },
    ]);
    answer(true);
    await expect(confirmations.requireDefinitionCommand(command(), closedWindow)).resolves.toEqual({
      kind: 'declined',
    });
    expect(ask).toHaveBeenCalledOnce();
    await expect(readFile(path.join(root, 'confirmed-actions-v1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('never persists a late yes after the closed-window caller has already received declined', async () => {
    const closedWindow = new EventEmitter() as BrowserWindow;
    let answer!: (answer: boolean) => void;
    const ask = vi
      .fn(async () => true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          }),
      );
    const confirmations = new ExecutionConfirmations(root, ask);
    const pending = confirmations.requireDefinitionCommand(command(), closedWindow);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    closedWindow.emit('closed');
    await expect(pending).resolves.toEqual({ kind: 'declined' });
    answer(true);
    // A later durable approval drains the shared record queue before inspecting disk and memory.
    await confirmations.requireTerminalApplication('/fixture/Barrier.app');
    const saved = JSON.parse(
      await readFile(path.join(root, 'confirmed-actions-v1.json'), 'utf8'),
    ) as string[];
    expect(saved).toHaveLength(1);
    expect(saved).not.toContain(definitionCommandFingerprint(command()));
    await confirmations.requireDefinitionCommand(command(), window);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('checks the window again when a reviewed approval reaches the persistence queue', async () => {
    const closedWindow = new EventEmitter() as BrowserWindow;
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const save = DocumentStore.prototype.save;
    let release!: () => void;
    let saving!: Promise<void>;
    const spy = vi.spyOn(DocumentStore.prototype, 'save').mockImplementationOnce(function (
      this: DocumentStore<unknown>,
      value,
    ) {
      saving = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => save.call(this, value));
      return saving;
    });
    const barrier = confirmations.requireTerminalApplication('/fixture/Barrier.app');
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    const pending = confirmations.requireDefinitionCommand(command(), closedWindow);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    closedWindow.emit('closed');
    await expect(pending).resolves.toEqual({ kind: 'declined' });
    release();
    await saving;
    await barrier;
    await confirmations.requireTerminalApplication('/fixture/Second-barrier.app');
    const saved = JSON.parse(
      await readFile(path.join(root, 'confirmed-actions-v1.json'), 'utf8'),
    ) as string[];
    expect(saved).not.toContain(definitionCommandFingerprint(command()));
    expect(saved).toHaveLength(2);
  });

  it('quotes the same argument boundaries in profile and definition reviews', async () => {
    const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const profile = {
      ...command().profile,
      executable: '/fixture/custom sh',
      args: ['-c', 'echo "two words"; exec zsh', "a'b", '$HOME'],
      env: { MODE: 'two words' },
    };
    await confirmations.requireTerminal(profile);
    await confirmations.requireDefinitionCommand(command({ profile }), window);
    const program = ask.mock.calls[0]![0].detail;
    expect(program).toBe(
      "MODE='two words' '/fixture/custom sh' -c 'echo \"two words\"; exec zsh' 'a'\\''b' '$HOME'",
    );
    expect(ask.mock.calls[1]![0].detail).toContain(`Program: ${program}`);
  });
  it('does not make an approved profile depend on a writable store', async () => {
    const confirmations = new ExecutionConfirmations(root, async () => true);
    const profile = { ...command().profile, executable: '/bin/sh' };
    await confirmations.requireTerminal(profile);
    const save = vi
      .spyOn(DocumentStore.prototype, 'save')
      .mockRejectedValue(new Error('Read-only disk'));
    await expect(confirmations.requireTerminal(profile)).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not write again for repeated uses of the newest approval', async () => {
    const confirmations = new ExecutionConfirmations(root, async () => true);
    const profile = { ...command().profile, executable: '/bin/sh' };
    await confirmations.requireTerminal(profile);
    const save = vi.spyOn(DocumentStore.prototype, 'save');
    for (let index = 0; index < 5; index++) await confirmations.requireTerminal(profile);
    expect(save).not.toHaveBeenCalled();
  });

  it('debounces changed recency and ignores a read-only store for every existing approval route', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const profile = { ...command().profile, executable: '/bin/sh' };
    const action = {
      id: 'review',
      name: 'Review',
      icon: 'terminal',
      aliases: [],
      shortcut: '',
      order: 0,
      pinned: false,
      when: { target: 'any' as const, extensions: [], min: 0, max: 100 },
      executor: {
        kind: 'shell' as const,
        executable: '/bin/sh',
        script: 'echo review',
        perItem: false,
      },
    };
    const uses = [
      () => confirmations.requireTerminal(profile),
      () => confirmations.require(action),
      () => confirmations.requireTmux('/fixture/tmux', '', {}),
      () => confirmations.requireTerminalApplication('/fixture/Terminal.app'),
      () => confirmations.requireDefinitionCommand(command(), window),
    ];
    for (const use of uses) await use();
    await confirmations.requireTerminalApplication('/fixture/Newer.app');
    const dialogs = ask.mock.calls.length;
    const save = vi
      .spyOn(DocumentStore.prototype, 'save')
      .mockRejectedValue(new Error('Read-only disk'));
    vi.useFakeTimers();
    try {
      for (let index = 0; index < 5; index++) {
        for (const use of uses) await use();
        await vi.advanceTimersByTimeAsync(40);
      }
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(save).toHaveBeenCalledOnce();
      for (const use of uses) await use();
      expect(ask).toHaveBeenCalledTimes(dialogs);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns exactly the fingerprints represented by the canonical folders in the dialog', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const alias = path.join(root, 'alias');
    await symlink(cwd, alias);
    const result = await confirmations.requireDefinitionCommand(command({ cwd: alias }), window);
    expect(result).toEqual({
      kind: 'approved',
      fingerprints: [definitionCommandFingerprint(command())],
    });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining(`Folder: ${cwd}`) }),
      window,
    );
  });

  it('queues overlapping requests and re-filters after the earlier approval', async () => {
    const answers: ((answer: boolean) => void)[] = [];
    const ask = vi.fn(() => new Promise<boolean>((resolve) => answers.push(resolve)));
    const confirmations = new ExecutionConfirmations(root, ask);
    const a = command();
    const b = command({ command: 'npm test' });
    const first = confirmations.requireDefinitionCommands([a, b], window);
    const second = confirmations.requireDefinitionCommands([a], window);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    answers[0]!(true);
    await expect(first).resolves.toMatchObject({ kind: 'approved' });
    await expect(second).resolves.toEqual({
      kind: 'approved',
      fingerprints: [definitionCommandFingerprint(a)],
    });
    expect(ask).toHaveBeenCalledOnce();
  });

  it('asks the next overlapping request only about its remaining unapproved commands', async () => {
    const answers: ((answer: boolean) => void)[] = [];
    const ask = vi.fn(
      (_summary: { title: string; detail: string }) =>
        new Promise<boolean>((resolve) => answers.push(resolve)),
    );
    const confirmations = new ExecutionConfirmations(root, ask);
    const a = command();
    const b = command({ command: 'npm test' });
    const first = confirmations.requireDefinitionCommands([a], window);
    const second = confirmations.requireDefinitionCommands([a, b], window);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    answers[0]!(true);
    await first;
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[1]![0].detail).not.toContain('Command: npm run dev');
    expect(ask.mock.calls[1]![0].detail).toContain('Command: npm test');
    answers[1]!(false);
    await expect(second).resolves.toEqual({ kind: 'declined' });
    await expect(confirmations.requireDefinitionCommand(a, window)).resolves.toMatchObject({
      kind: 'approved',
    });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('escapes names, folders, program arguments and separators as visible single-line text', async () => {
    const folder = path.join(root, 'project\nFolder: other\u2028tail');
    await mkdir(folder);
    const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.requireDefinitionCommand(
      command({
        cwd: folder,
        workspaceName: 'Sample\nCommand: pretend\u202e',
        profile: {
          ...command().profile,
          name: 'Login\r\nCommand: pretend\t\u2066',
          executable: '/fixture/sh',
          args: ['-c', 'echo one\necho two'],
          env: { MODE: 'a\tb' },
        },
      }),
      window,
    );
    const summary = ask.mock.calls[0]![0];
    expect(summary.title).toContain('Sample\\nCommand: pretend\\u202e');
    expect(summary.detail.split('\n')).toEqual([
      'Command 1 of 1',
      `Folder: ${root}/project\\nFolder: other\\u2028tail`,
      'Terminal profile: Login\\r\\nCommand: pretend\\t\\u2066',
      "Program: MODE='a\\tb' /fixture/sh -c 'echo one\\necho two'",
      'Command: npm run dev',
      '',
      'Viewer asks again if a command, its folder or its terminal profile changes.',
    ]);
  });

  it('reviews every long batch item in bounded dialogs without truncation', async () => {
    const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const items = Array.from({ length: 30 }, (_, index) =>
      command({ command: `echo ${index} ` + 'x'.repeat(980) }),
    );
    const result = await confirmations.requireDefinitionCommands(items, window);
    expect(result).toEqual({
      kind: 'approved',
      fingerprints: items.map(definitionCommandFingerprint),
    });
    expect(ask.mock.calls.length).toBeGreaterThan(1);
    for (const [summary] of ask.mock.calls) {
      expect(summary.detail.length).toBeLessThanOrEqual(6000);
      expect(summary.detail).toMatch(/^Command \d+ of 30\n/);
      for (const line of summary.detail.split('\n').filter((line) => line.startsWith('Command: ')))
        expect(items.some((item) => line === `Command: ${item.command}`)).toBe(true);
    }
    const detail = ask.mock.calls.map(([summary]) => summary.detail).join('\n');
    for (const item of items) expect(detail).toContain(`Command: ${item.command}`);
  });

  it('reviews oversized profile text without losing any program text', async () => {
    const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const program = 'x'.repeat(14000) + 'PROFILE_END';
    await confirmations.requireDefinitionCommand(
      command({ profile: { ...command().profile, executable: '/fixture/sh', args: [program] } }),
      window,
    );
    const shownProgram = ask.mock.calls
      .flatMap(([summary]) =>
        [...summary.detail.matchAll(/^Program(?: \(continued\))?: (.*)$/gm)].map(
          (match) => match[1],
        ),
      )
      .join('');
    expect(shownProgram).toBe('/fixture/sh ' + program);
    for (const [summary] of ask.mock.calls) expect(summary.detail).toMatch(/^Command 1 of 1\n/);
    expect(ask.mock.calls.every(([summary]) => summary.detail.length <= 6000)).toBe(true);
  });

  it.each(['a', 'aa'])(
    'keeps Unicode characters whole when wrapping an oversized program: %s',
    async (prefix) => {
      const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
      const confirmations = new ExecutionConfirmations(root, ask);
      const program = prefix + '🙂'.repeat(7000);
      await confirmations.requireDefinitionCommand(
        command({
          profile: { ...command().profile, executable: '/fixture/sh', args: [program] },
        }),
        window,
      );
      const chunks = ask.mock.calls.flatMap(([summary]) =>
        [...summary.detail.matchAll(/^Program(?: \(continued\))?: (.*)$/gm)].map(
          (match) => match[1]!,
        ),
      );
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) expect(chunk).not.toMatch(/\p{Cs}/u);
      expect(chunks.join('')).toBe(`/fixture/sh '${program}'`);
    },
  );

  it('records none of a split batch if a later review is declined', async () => {
    const ask = vi
      .fn(async () => true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const confirmations = new ExecutionConfirmations(root, ask);
    const items = Array.from({ length: 10 }, (_, index) =>
      command({ command: `echo ${index} ` + 'x'.repeat(980) }),
    );
    await expect(confirmations.requireDefinitionCommands(items, window)).resolves.toEqual({
      kind: 'declined',
    });
    await expect(readFile(path.join(root, 'confirmed-actions-v1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refreshes a reused command and a reused executor before evicting older approvals', async () => {
    const application = '/fixture/Terminal.app';
    const applicationKey = createHash('sha256')
      .update(JSON.stringify({ application }))
      .digest('hex');
    const commandKey = definitionCommandFingerprint(command());
    const stale = Array.from({ length: 998 }, (_, index) =>
      createHash('sha256').update(`old-${index}`).digest('hex'),
    );
    await writeFile(
      path.join(root, 'confirmed-actions-v1.json'),
      JSON.stringify([commandKey, applicationKey, ...stale]),
    );
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.requireDefinitionCommand(command(), window);
    await confirmations.requireTerminalApplication(application);
    await confirmations.requireDefinitionCommand(command({ command: 'npm test' }), window);
    const saved = JSON.parse(
      await readFile(path.join(root, 'confirmed-actions-v1.json'), 'utf8'),
    ) as string[];
    expect(saved).toHaveLength(1000);
    expect(saved).toContain(commandKey);
    expect(saved).toContain(applicationKey);
    expect(saved).not.toContain(stale[0]);
    expect(ask).toHaveBeenCalledOnce();
  });

  it('asks again after a failed save instead of granting an in-memory approval', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    vi.spyOn(DocumentStore.prototype, 'save').mockRejectedValueOnce(new Error('Store unavailable'));
    await expect(confirmations.requireDefinitionCommand(command(), window)).rejects.toThrow(
      'Store unavailable',
    );
    await expect(confirmations.requireDefinitionCommand(command(), window)).resolves.toMatchObject({
      kind: 'approved',
    });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('preserves simultaneous command batches and terminal approvals in the shared store', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const first = command();
    const second = command({ command: 'npm test' });
    await Promise.all([
      confirmations.requireDefinitionCommand(first, window),
      confirmations.requireDefinitionCommand(second, window),
      confirmations.requireTerminalApplication('/fixture/Terminal.app'),
    ]);
    const reloaded = new ExecutionConfirmations(root, ask);
    await reloaded.requireDefinitionCommands([first, second], window);
    await reloaded.requireTerminalApplication('/fixture/Terminal.app');
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('stores the specified fingerprint with existing approvals and remembers it across loads', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.requireTerminalApplication('/fixture/Terminal.app');
    await expect(confirmations.requireDefinitionCommand(command(), window)).resolves.toMatchObject({
      kind: 'approved',
    });
    const item = command();
    const { executable, args, env } = item.profile;
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          definitionCommand: {
            key: item.key,
            cwd,
            profile: { executable, args, env },
            command: item.command,
          },
        }),
      )
      .digest('hex');
    const saved = JSON.parse(await readFile(path.join(root, 'confirmed-actions-v1.json'), 'utf8'));
    expect(saved).toHaveLength(2);
    expect(saved).toContain(expected);
    const reloaded = new ExecutionConfirmations(root, ask);
    await expect(reloaded.requireDefinitionCommand(command(), window)).resolves.toMatchObject({
      kind: 'approved',
    });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it.each(['key', 'folder', 'executable', 'args', 'env', 'command'] as const)(
    'asks again when the %s changes',
    async (field) => {
      const ask = vi.fn(async () => true);
      const confirmations = new ExecutionConfirmations(root, ask);
      await confirmations.requireDefinitionCommand(command(), window);
      const changed = command();
      if (field === 'key') changed.key = 'tools/renamed';
      if (field === 'folder') changed.cwd = other;
      if (field === 'executable') changed.profile.executable = '/bin/sh';
      if (field === 'args') changed.profile.args = ['-l', '-i'];
      if (field === 'env') changed.profile.env = { MODE: 'preview' };
      if (field === 'command') changed.command = 'npm run preview';
      await confirmations.requireDefinitionCommand(changed, window);
      expect(ask).toHaveBeenCalledTimes(2);
    },
  );

  it('uses real folders and ignores changes to display names or profile IDs', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.requireDefinitionCommand(command(), window);
    const alias = path.join(root, 'alias');
    await symlink(cwd, alias);
    await confirmations.requireDefinitionCommand(
      command({
        cwd: alias,
        workspaceName: 'Renamed',
        profile: { ...command().profile, id: 'renamed', name: 'Renamed profile' },
      }),
      window,
    );
    expect(ask).toHaveBeenCalledOnce();
  });

  it('shows only unapproved commands, literal text, folder, profile and the requesting window', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.requireDefinitionCommand(command(), window);
    ask.mockClear();
    const second = command({ command: 'echo "two" && npm run build', cwd: other });
    const third = command({ command: 'npm test' });
    await confirmations.requireDefinitionCommands([command(), second, third], window);
    expect(ask).toHaveBeenCalledExactlyOnceWith(
      {
        title: 'Run 2 commands in “Sample”?',
        detail: `Command 1 of 2\nFolder: ${other}\nTerminal profile: Login shell\nCommand: echo "two" && npm run build\n\nCommand 2 of 2\nFolder: ${cwd}\nTerminal profile: Login shell\nCommand: npm test\n\nViewer asks again if a command, its folder or its terminal profile changes.`,
      },
      window,
    );
    const reloaded = new ExecutionConfirmations(root, ask);
    await reloaded.requireDefinitionCommands([command(), second, third], window);
    expect(ask).toHaveBeenCalledOnce();
  });

  it('declines the entire batch, records nothing and asks again next time', async () => {
    const ask = vi.fn(async () => false);
    const confirmations = new ExecutionConfirmations(root, ask);
    const items = [command(), command({ command: 'npm test' })];
    await expect(confirmations.requireDefinitionCommands(items, window)).resolves.toEqual({
      kind: 'declined',
    });
    await expect(readFile(path.join(root, 'confirmed-actions-v1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(confirmations.requireDefinitionCommands(items, window)).resolves.toEqual({
      kind: 'declined',
    });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    'shares one concurrent dialog, including reordered items, for answer %s',
    async (approved) => {
      let answer!: (approved: boolean) => void;
      const ask = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          }),
      );
      const confirmations = new ExecutionConfirmations(root, ask);
      const items = [command(), command({ command: 'npm test' })];
      const first = confirmations.requireDefinitionCommands(items, window);
      const second = confirmations.requireDefinitionCommands([...items].reverse(), window);
      await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
      answer(approved);
      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ kind: approved ? 'approved' : 'declined' }),
        expect.objectContaining({ kind: approved ? 'approved' : 'declined' }),
      ]);
    },
  );

  it('does not ask for an empty batch and deduplicates identical approvals', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await expect(confirmations.requireDefinitionCommands([], window)).resolves.toMatchObject({
      kind: 'approved',
    });
    expect(ask).not.toHaveBeenCalled();
    await confirmations.requireDefinitionCommands([command(), command()], window);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Run 1 command in “Sample”?' }),
      window,
    );
    expect(
      JSON.parse(await readFile(path.join(root, 'confirmed-actions-v1.json'), 'utf8')),
    ).toHaveLength(1);
  });
});
