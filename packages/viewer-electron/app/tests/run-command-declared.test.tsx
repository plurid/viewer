// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type {
  DeclaredCommand,
  DeclaredCommandsReply,
} from '../src/domain/terminals/declared-commands';
import { RunCommandDialog } from '../src/renderer/terminals/RunCommandDialog';
import { QuickCommand } from '../src/renderer/terminals/QuickCommand';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, update } from '../src/renderer/state/core';
import { initialize } from '../src/renderer/state/store';
import {
  editQuickCommand,
  observeQuickCommands,
  quickCommandSnapshot,
} from '../src/renderer/terminals/quick-command';
import { createTerminalHandlers } from '../src/desktop/ipc/terminal-handlers';
import { schemas, methodWindows } from '../src/desktop/ipc/schemas';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { readFileSync } from 'node:fs';

let root: string;
let target: CapturedTarget;
const run = vi.fn(async () => 'receipt');
const declared = vi.fn<(directory: string) => Promise<DeclaredCommandsReply>>();
const commands: DeclaredCommand[] = [
  {
    file: 'package.json',
    source: 'package.json',
    name: 'dev',
    line: 'pnpm run dev',
    detail: 'vite',
  },
  {
    file: 'Makefile',
    source: 'Makefile',
    name: 'test',
    line: 'make test',
    detail: 'Run the checks',
    lastRun: true,
  },
];
beforeEach(async () => {
  root = await temporaryRoot('viewer-run-declared-');
  initialize({ home: root, platform: 'darwin', state: null, locations: [], openPaths: [] });
  const workspace = activeWorkspace();
  const pane = workspace.panes[0]!;
  target = {
    workspaceID: workspace.id,
    rootID: pane.id,
    paneID: pane.id,
    panePath: pane.path,
    directory: root,
    selection: [],
  };
  run.mockReset().mockResolvedValue('receipt');
  declared.mockReset().mockResolvedValue({ commands });
  const task = quickCommandSnapshot().task;
  if (task) observeQuickCommands([{ ...task, status: 'completed' }]);
  editQuickCommand('');
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      runCommand: run,
      declaredCommands: declared,
      commandDraft: vi.fn(async () => {}),
    },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await trashTemporary(root);
});

function quick() {
  const context: CommandContext = {
    scope: 'folder',
    workspaceID: target.workspaceID,
    paneID: target.paneID,
    directory: root,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  const controller = {
    rootID: () => target.rootID,
    openReceipt: vi.fn(),
  } as unknown as WorkspaceController;
  return render(
    <WorkspaceContext.Provider value={controller}>
      <QuickCommand context={context} initialQuery="" onBack={vi.fn()} onClose={vi.fn()} />
    </WorkspaceContext.Provider>,
  );
}

describe('declared command picks', () => {
  it('review regression: waits for IPC settlement before asserting agent-driven suggestions stay absent', async () => {
    act(() => update({ ...getState(), bootstrap: { ...getState().bootstrap, agentDriven: true } }));
    const view = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    await act(async () => {});
    expect(declared).not.toHaveBeenCalled();
    expect(view.queryByRole('region', { name: 'Declared commands' })).toBeNull();
  });

  it('review regression: groups ancestor sources and shows bodies and context without losing siblings', async () => {
    declared.mockResolvedValue({
      commands: [
        { ...commands[0]!, source: 'app/package.json', relativeSource: '../package.json' },
        {
          ...commands[0]!,
          source: 'app/package.json',
          relativeSource: '../package.json',
          name: 'build',
          line: 'pnpm run build',
        },
        { ...commands[1]!, relativeSource: '../../../Makefile', context: 'Run the checks' },
      ],
    });
    const view = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    const list = await view.findByRole('region', { name: 'Declared commands' });
    const group = within(list).getByRole('region', { name: '../package.json' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(within(group).getAllByText('vite')).toHaveLength(2);
    expect(within(list).getByRole('region', { name: '../../../Makefile' })).toBeDefined();
  });

  it('review regression: a pick clears an earlier error and suggestions hide while saving an action', async () => {
    run.mockRejectedValue(new Error('Command refused'));
    const view = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    fireEvent.change(view.getByRole('textbox', { name: 'Command' }), {
      target: { value: 'echo typed' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Run' }));
    await view.findByRole('alert');
    const list = await view.findByRole('region', { name: 'Declared commands' });
    fireEvent.click(within(list).getByRole('button', { name: /pnpm run dev/ }));
    expect(view.queryByRole('alert')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Save as action…' }));
    expect(view.queryByRole('region', { name: 'Declared commands' })).toBeNull();
  });

  it('review regression: keeps the Run footer sticky inside the dialog scroll area', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/renderer/terminals/run-command.css', 'utf8');
    document.head.append(style);
    try {
      const view = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
      const footer = view.getByRole('button', { name: 'Run' }).closest('footer')!;
      expect(getComputedStyle(footer).position).toBe('sticky');
      expect(getComputedStyle(footer).bottom).toBe('0px');
      expect(getComputedStyle(footer).flexShrink).toBe('0');
    } finally {
      style.remove();
    }
  });

  it('review regression: preserves the existing Quick command Run button style', () => {
    const view = quick();
    expect(view.getByRole('button', { name: 'Run' }).classList.contains('primary')).toBe(false);
  });
  it.each(['dialog', 'quick'] as const)(
    'fills the %s input and focuses it without running anything',
    async (surface) => {
      const view =
        surface === 'dialog'
          ? render(<RunCommandDialog target={target} onClose={vi.fn()} />)
          : quick();
      const list = await view.findByRole('region', { name: 'Declared commands' });
      const rows = within(list).getAllByRole('button');
      expect(rows[0]!.textContent).toContain('make test');
      expect(rows[0]!.textContent).toContain('Last run');
      expect(within(list).getByRole('region', { name: 'package.json' })).toBeDefined();
      rows[0]!.focus();
      expect(document.activeElement).toBe(rows[0]);
      fireEvent.click(within(list).getByRole('button', { name: /pnpm run dev/ }));
      const input = view.getByRole('textbox', {
        name: surface === 'dialog' ? 'Command' : 'Shell command',
      }) as HTMLTextAreaElement;
      expect(input.value).toBe('pnpm run dev');
      expect(document.activeElement).toBe(input);
      expect(run).not.toHaveBeenCalled();
      expect(view.container.querySelectorAll('button.primary')).toHaveLength(
        surface === 'dialog' ? 1 : 0,
      );
      fireEvent.click(view.getByRole('button', { name: 'Run' }));
      await waitFor(() =>
        expect(run).toHaveBeenCalledExactlyOnceWith(
          'pnpm run dev',
          expect.objectContaining({ directory: root }),
        ),
      );
    },
  );

  it('places declared commands above Recent and shows at most eight keyboard-reachable rows', async () => {
    const first = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    fireEvent.change(first.getByRole('textbox', { name: 'Command' }), {
      target: { value: 'echo recent' },
    });
    fireEvent.click(first.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    first.unmount();
    declared.mockResolvedValue({
      commands: Array.from({ length: 12 }, (_, index) => ({
        ...commands[0]!,
        name: 'task-' + index,
        line: 'pnpm run task-' + index,
      })),
    });
    const view = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    const list = await view.findByRole('region', { name: 'Declared commands' });
    expect(within(list).getAllByRole('button')).toHaveLength(8);
    const recent = view.getByRole('region', { name: 'Recent commands' });
    expect(list.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const row of within(list).getAllByRole('button')) {
      expect(row.getAttribute('type')).toBe('button');
      row.focus();
      expect(document.activeElement).toBe(row);
    }
  });

  it('leaves typing responsive and ignores a slow or failed discovery result', async () => {
    vi.useFakeTimers();
    let answer!: (value: DeclaredCommandsReply) => void;
    declared.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const view = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    const input = view.getByRole('textbox', { name: 'Command' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'echo typed' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
      answer({ commands });
    });
    expect(input.value).toBe('echo typed');
    expect(view.queryByRole('region', { name: 'Declared commands' })).toBeNull();
    expect(view.queryByRole('alert')).toBeNull();
    expect(run).not.toHaveBeenCalled();
    view.unmount();
    declared.mockRejectedValue(new Error('Unavailable'));
    const failed = render(<RunCommandDialog target={target} onClose={vi.fn()} />);
    await act(async () => {});
    expect(failed.queryByRole('region', { name: 'Declared commands' })).toBeNull();
    expect(failed.queryByRole('alert')).toBeNull();
  });

  it('shows quick suggestions only while the draft is empty and hides them for an agent-driven window', async () => {
    const view = quick();
    await view.findByRole('region', { name: 'Declared commands' });
    fireEvent.change(view.getByRole('textbox', { name: 'Shell command' }), {
      target: { value: 'echo typed' },
    });
    expect(view.queryByRole('region', { name: 'Declared commands' })).toBeNull();
    act(() => update({ ...getState(), bootstrap: { ...getState().bootstrap, agentDriven: true } }));
    fireEvent.change(view.getByRole('textbox', { name: 'Shell command' }), {
      target: { value: '' },
    });
    expect(view.queryByRole('region', { name: 'Declared commands' })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('declared command desktop boundary', () => {
  function handlers() {
    let agent = false,
      viewer = true;
    const list = vi.fn(async () => ({ commands }));
    const record = vi.fn<(directory: string, line: string, revision?: number) => Promise<void>>(async () => {});
    const metadata = { list, record: (directory: string, line: string, revision?: number) => record(directory, line, revision), revision: 4 };
    const startManual = vi.fn(async () => 'receipt');
    const service = createTerminalHandlers({
      home: root,
      declaredCommands: metadata,
      executions: { startManual },
      isAgent: () => agent,
      isViewer: () => viewer,
      gitWindow: () => ({
        alive: true,
        originID: 'window',
        workspaceID: target.workspaceID,
        workspaces: {
          workspaces: [
            {
              id: target.workspaceID,
              roots: [target.rootID],
              panes: [{ id: target.paneID, type: 'folder', path: root }],
            },
          ],
        },
      }),
    } as unknown as Parameters<typeof createTerminalHandlers>[0]);
    return {
      service,
      list,
      record,
      startManual,
      replaceRecord: (work: typeof metadata.record) => { metadata.record = work; },
      agent: () => {
        agent = true;
      },
      other: () => {
        viewer = false;
      },
    };
  }

  it.each(['agent', 'agent-driven', 'settings'] as const)(
    'refuses %s discovery before reading',
    async (kind) => {
      const f = handlers();
      if (kind === 'settings') f.other();
      else f.agent();
      await expect(f.service.declaredCommands([root], 1)).rejects.toThrow('require a person');
      expect(f.list).not.toHaveBeenCalled();
    },
  );

  it('refuses a window that becomes agent-driven while discovery is pending', async () => {
    const f = handlers();
    f.list.mockImplementation(async () => {
      f.agent();
      return { commands };
    });
    await expect(f.service.declaredCommands([root], 1)).rejects.toThrow('require a person');
  });

  it('records only after a successful manual start and leaves the existing typed-line route intact', async () => {
    const f = handlers();
    await expect(f.service.runCommand(['pnpm run dev', target], 1)).resolves.toBe('receipt');
    expect(f.record).toHaveBeenCalledExactlyOnceWith(root, 'pnpm run dev', 4);
    expect(f.record.mock.invocationCallOrder[0]!).toBeGreaterThan(
      f.startManual.mock.invocationCallOrder[0]!,
    );
    f.record.mockClear();
    f.startManual.mockRejectedValue(new Error('Declined'));
    await expect(f.service.runCommand(['pnpm run dev', target], 1)).rejects.toThrow('Declined');
    expect(f.record).not.toHaveBeenCalled();
  });

  it('review regression: replies before a slow record and survives a failed background record', async () => {
    const f = handlers();
    let finish!: () => void;
    f.record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let receipt: unknown;
    void Promise.resolve(f.service.runCommand(['pnpm run dev', target], 1)).then((value) => {
      receipt = value;
    });
    try {
      await waitFor(() => expect(receipt).toBe('receipt'));
    } finally {
      finish?.();
    }
    f.replaceRecord(() => Promise.reject(new Error('Read-only reference store')));
    await expect(f.service.runCommand(['pnpm run dev', target], 1)).resolves.toBe('receipt');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps the endpoint workspace-only and accepts no command or reference from a renderer', () => {
    expect(methodWindows.declaredCommands).toBe('viewer');
    expect(schemas.declaredCommands.safeParse([root]).success).toBe(true);
    expect(schemas.declaredCommands.safeParse([root, { command: 'injected' }]).success).toBe(false);
  });
});
