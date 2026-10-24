// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopEvent } from '../src/domain/contracts';
import type { GitActionRequest } from '../src/domain/comparison/git-actions';
import { runGitAction } from '../src/renderer/git/runtime';
import { terminalSession, trimTerminals } from '../src/renderer/terminals/sessions';

const fake = vi.hoisted(() => ({
  terminals: [] as Array<{
    output: string[];
    input?: (data: string) => void;
    disposed: boolean;
  }>,
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    output: string[] = [];
    input?: (data: string) => void;
    disposed = false;
    options: Record<string, unknown> = {};
    constructor() {
      fake.terminals.push(this);
    }
    write(data: string, acknowledged?: () => void) {
      this.output.push(data);
      acknowledged?.();
    }
    writeln(data: string) {
      this.output.push(data);
    }
    onData(callback: (data: string) => void) {
      this.input = callback;
    }
    onResize() {}
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));

let listener: ((event: DesktopEvent) => void) | undefined;
const git = vi.fn();
const write = vi.fn(async () => {});
const close = vi.fn(async () => {});
const startShell = vi.fn(async () => {});
let sequence = 0;
const request = (kind: 'status' | 'commit' = 'status'): GitActionRequest => ({
  id: `git-${++sequence}`,
  target: {
    workspaceID: 'work',
    rootID: 'folder',
    paneID: 'folder',
    panePath: '/fixture',
    directory: '/fixture',
    selection: [],
  },
  ...(kind === 'commit' ? { kind, message: 'Literal $(message)' } : { kind }),
});

beforeEach(() => {
  git.mockReset();
  write.mockClear();
  close.mockClear();
  startShell.mockClear();
  fake.terminals.length = 0;
  Object.assign(window, {
    viewer: {
      onEvent: (callback: typeof listener) => {
        listener = callback;
        return () => {};
      },
      gitAction: git,
      terminalStart: startShell,
      terminalWrite: write,
      terminalClose: close,
      terminalAck: vi.fn(async () => {}),
    },
  });
});
afterEach(() => trimTerminals(new Set()));

describe('Git terminal handoff', () => {
  it('retains the first output and exit even when Git finishes before its plane mounts', async () => {
    const input = request();
    git.mockImplementation(async () => {
      listener?.({ type: 'terminal', event: { type: 'data', id: input.id, data: 'clean\r\n' } });
      listener?.({ type: 'terminal', event: { type: 'exit', id: input.id, code: 0 } });
      return { id: input.id, root: '/fixture', title: 'Git status' };
    });
    await runGitAction(input, 1000, () => {});
    const session = await terminalSession(
      {
        id: input.id,
        workspaceID: 'work',
        rootID: 'folder',
        cwd: '/fixture',
        profileID: '@viewer-git',
        cols: 80,
        rows: 24,
      },
      1000,
    );
    expect(session.exited).toBe(true);
    expect(fake.terminals[0]!.output).toEqual([
      'clean\r\n',
      '\r\nGit exited (0). Close this plane to finish.',
    ]);
    expect(startShell).not.toHaveBeenCalled();
    fake.terminals[0]!.input?.('do not execute');
    expect(write).not.toHaveBeenCalled();
  });

  it('retains a preparing session across unrelated layout updates and accepts input only after review', async () => {
    const input = request('commit');
    let finish!: (reply: { id: string; root: string; title: string }) => void;
    git.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let published = false;
    const running = runGitAction(input, 1000, () => {
      trimTerminals(new Set());
      expect(fake.terminals[0]!.disposed).toBe(false);
      expect(close).not.toHaveBeenCalled();
      published = true;
    });
    await vi.waitFor(() => expect(git).toHaveBeenCalledOnce());
    trimTerminals(new Set());
    expect(close).not.toHaveBeenCalled();
    fake.terminals[0]!.input?.('before review');
    expect(write).not.toHaveBeenCalled();
    finish({ id: input.id, root: '/fixture', title: 'Git commit' });
    await running;
    expect(published).toBe(true);
    fake.terminals[0]!.input?.('signing input');
    expect(write).toHaveBeenCalledWith(input.id, 'signing input');
    expect(git).toHaveBeenCalledWith(input);
  });

  it('closes an unused terminal when review is rejected without starting a fallback shell', async () => {
    const input = request('commit');
    git.mockRejectedValue(new Error('Git action was not confirmed. Nothing was run.'));
    await expect(runGitAction(input, 1000, () => {})).rejects.toThrow('not confirmed');
    expect(close).toHaveBeenCalledWith(input.id);
    expect(fake.terminals[0]!.disposed).toBe(true);
    expect(startShell).not.toHaveBeenCalled();
  });
});
