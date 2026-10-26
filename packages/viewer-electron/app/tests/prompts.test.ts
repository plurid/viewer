// @vitest-environment jsdom
/**
 * A request in words: `>` in the palette asks a model for one line of the command
 * language, which the person reads and runs; the line may not do what a model may not ask for;
 * the model is told the commands, the folder's path and the selected names, nothing more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import {
  promptInstructions,
  promptLineProblem,
  type PromptContext,
  type PromptRequest,
} from '../src/domain/command-line/prompt';
import { answerPrompt } from '../src/desktop/models/prompts';
import { defaultSettings, type ApplicationSettings } from '../src/domain/services';
import { newModelProvider } from '../src/domain/models/providers';
import type { CustomAction } from '../src/domain/automation/actions';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import type { PaletteMode } from '../src/renderer/commands/palette-modes';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import {
  activeWorkspace,
  getState,
  initialize,
  receiveSettings,
} from '../src/renderer/state/store';
import type { LineHost } from '../src/renderer/command-line/host';
import { columnCommands } from '../src/renderer/commands/columns';

const context: PromptContext = {
  folder: '/Users/me/Studio',
  selection: ['notes.md'],
  workspace: 'Studio',
  workspaces: ['Studio'],
  commands: [
    { id: 'sort.modified', label: 'Sort by date modified' },
    { id: 'trash', label: 'Move to Trash' },
    { id: 'open-terminal', label: 'Open in Terminal' },
    { id: 'custom.script', label: 'Run script' },
    { id: 'frame-all', label: 'Frame all planes' },
  ],
  userCommands: ['Dev'],
};
const ids = new Set(context.commands.map((command) => command.id));
const actions = [
  {
    id: 'script',
    name: 'Run script',
    executor: { kind: 'shell', executable: '/bin/zsh', script: 'x', perItem: false },
  },
] as unknown as CustomAction[];

describe('a line a model proposes', () => {
  const problem = (line: string) =>
    promptLineProblem(line, ids, actions, new Map([['Dev', ['frame-all']]]));
  it('may set, filter, sort, select and lay out, and run the person’s commands', () => {
    for (const line of [
      'sort.modified',
      'set nogrid | filter ext:pdf modified<7d',
      'select *.png',
      'vs ~/Documents | frame-all',
      'Dev',
    ])
      expect(problem(line), line).toBeUndefined();
  });
  it('may not trash, rename, type, bind, save, drop unsaved text or run programs', () => {
    expect(problem('trash')).toMatch(/:trash/);
    expect(problem('mv new.md')).toMatch(/:mv/);
    expect(problem("send-keys 'rm -rf ~' Enter")).toMatch(/:send-keys/);
    expect(problem('bind -n M-x qa!')).toMatch(/:bind/);
    expect(problem('w')).toMatch(/:w/);
    expect(problem('qa!')).toMatch(/drops unsaved text/);
    expect(problem('open-terminal')).toMatch(/terminal/);
    expect(problem('custom.script')).toMatch(/runs a program/);
    expect(problem('nosuch')).toMatch(/Not a command here/);
    expect(problem("e 'open")).toMatch(/quote/);
  });
  it('is asked for with the language, the settings and the commands here, not the refused verbs', () => {
    const instructions = promptInstructions(context);
    expect(instructions).toContain('vs[plit] [path]');
    expect(instructions).toContain('opacity (number 0-100)');
    expect(instructions).toContain('sort.modified: Sort by date modified');
    expect(instructions).toContain('Dev');
    expect(instructions).not.toContain('send-keys {text');
  });
});

describe('answering a prompt', () => {
  const request: PromptRequest = { id: 'one', prompt: 'sort by year', context };
  const settings = (): ApplicationSettings => {
    const value = defaultSettings('/Users/me');
    value.providers = [
      { ...newModelProvider('anthropic', 'first'), model: 'claude' },
      { ...newModelProvider('openai', 'second'), model: 'gpt' },
    ];
    value.prompts = { providerID: 'second' };
    value.customActions = actions;
    return value;
  };
  it.each([
    null,
    { line: 'frame-all' },
    { line: 'frame-all', explanation: 42 },
    { line: 'frame-all', explanation: 'Frame the planes.', unexpected: true },
  ])('rejects malformed model answers before offering a command line', async (answer) => {
    await expect(
      answerPrompt(request, settings(), async () => answer, new AbortController().signal),
    ).rejects.toThrow('The model returned an invalid command response. Try again.');
  });

  it('asks the model chosen for prompts, at the names level, and checks its line', async () => {
    const generate = vi.fn(async () => ({
      line: ':sort.modified',
      explanation: 'Sorts by date modified, newest first.',
    }));
    const answer = await answerPrompt(request, settings(), generate, new AbortController().signal);
    expect(answer).toEqual({
      line: 'sort.modified',
      explanation: 'Sorts by date modified, newest first.',
    });
    const [provider, instructions, input, , , level, actor] = generate.mock.calls[0]! as unknown[];
    expect(provider).toMatchObject({ id: 'second' });
    expect(instructions).toContain('ONE line');
    expect(input).toEqual({
      request: 'sort by year',
      folder: '/Users/me/Studio',
      selection: ['notes.md'],
      workspace: 'Studio',
      workspaces: ['Studio'],
    });
    expect([level, actor]).toEqual(['names', 'user']);
  });
  it('says what is wrong with a line it may not run, and needs a model', async () => {
    const answer = await answerPrompt(
      request,
      settings(),
      async () => ({ line: 'trash', explanation: 'Trashes it.' }),
      new AbortController().signal,
    );
    expect(answer.problem).toMatch(/:trash/);
    const none = defaultSettings('/Users/me');
    await expect(
      answerPrompt(request, none, vi.fn(), new AbortController().signal),
    ).rejects.toThrow(/Settings → Models/);
  });
});

describe('the palette’s > mode', () => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  const provider = { ...newModelProvider('anthropic', 'claude'), model: 'claude' };
  const viewer = {
    save: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
    providerPermissionGet: vi.fn(async () => null as unknown),
    providerPermissionSet: vi.fn(async () => {}),
    promptLine: vi.fn(async (_request: PromptRequest) => ({
      line: 'sort.modified',
      explanation: 'Newest first.',
    })),
    promptCancel: vi.fn(async () => {}),
    openSettings: vi.fn(async () => {}),
  };
  beforeEach(() => {
    for (const method of Object.values(viewer)) method.mockClear();
    Object.assign(window, { viewer });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.providers = [provider];
    act(() => receiveSettings(snapshot));
  });
  afterEach(cleanup);
  const show = () => {
    const run = vi.fn();
    const registry = new CommandRegistry();
    const live = () =>
      ({
        scope: 'window',
        workspaceID: activeWorkspace().id,
        paneID: activeWorkspace().panes[0]!.id,
        directory: '/fixtures',
        selection: [{ name: 'notes.md', path: '/fixtures/notes.md' }],
      }) as unknown as CommandContext;
    registry.register('window', {
      context: live,
      definitions: () => [
        {
          id: 'sort.modified',
          label: 'Sort by date modified',
          group: 'View',
          when: () => true,
          run: vi.fn(),
        },
        {
          id: 'setting.ui.space.grid',
          label: 'Hide grid',
          group: 'Settings',
          when: () => true,
          run: vi.fn(),
        },
        { id: 'workspace:x', label: 'Studio', group: 'Workspaces', when: () => true, run: vi.fn() },
      ],
    });
    const host = {
      registry,
      context: live,
      workspace: {} as WorkspaceController,
      invoke: vi.fn(async () => true),
      newWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      palette: vi.fn(),
    } satisfies LineHost;
    const Harness = () => {
      const [mode, setMode] = useState<PaletteMode>('commands');
      return createElement(CommandPalette, {
        mode,
        onMode: setMode,
        onClose: vi.fn(),
        line: { host, run },
      });
    };
    const view = render(
      createElement(
        CommandsContext.Provider,
        { value: registry },
        createElement(
          WorkspaceContext.Provider,
          { value: {} as WorkspaceController },
          createElement(Harness),
        ),
      ),
    );
    return { view, run };
  };
  it('asks first to send names to the provider', async () => {
    const { view } = show();
    fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: '>sort by year' },
    });
    const allow = await waitFor(() => view.getByRole('option', { name: /receive file names/ }));
    fireEvent.click(allow);
    expect(viewer.providerPermissionSet).toHaveBeenCalledWith('claude', provider.endpoint, 'names');
    expect(viewer.promptLine).not.toHaveBeenCalled();
  });
  it('sends the words with the folder, the selection and the commands; Enter runs the line', async () => {
    viewer.providerPermissionGet.mockResolvedValue({
      providerID: 'claude',
      kind: provider.kind,
      endpoint: new URL(provider.endpoint).href.replace(/\/+$/, ''),
      level: 'names',
    });
    const { view, run } = show();
    fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: '>sort by year' },
    });
    const field = await waitFor(() => view.getByRole('combobox', { name: 'Ask in words' }));
    await waitFor(() => view.getByRole('option', { name: /Ask: sort by year/ }));
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => view.getByRole('option', { name: /Newest first/ }));
    const request = viewer.promptLine.mock.calls[0]![0];
    expect(request).toMatchObject({
      prompt: 'sort by year',
      context: { folder: '/fixtures', selection: ['notes.md'] },
    });
    // the settings are told by name, and ids with a colon are this window's own
    expect(request.context.commands).toEqual([
      { id: 'sort.modified', label: 'Sort by date modified' },
    ]);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('sort.modified', true);
    expect(getState().saved.lineHistory).toEqual(['sort.modified']);
  });
  it('opens the line in the command line with Tab, to change it', async () => {
    viewer.providerPermissionGet.mockResolvedValue({
      providerID: 'claude',
      kind: provider.kind,
      endpoint: new URL(provider.endpoint).href.replace(/\/+$/, ''),
      level: 'names',
    });
    const { view } = show();
    fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: '>sort by year' },
    });
    const field = await waitFor(() => view.getByRole('combobox', { name: 'Ask in words' }));
    await waitFor(() => view.getByRole('option', { name: /Ask:/ }));
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => view.getByRole('option', { name: /Newest first/ }));
    fireEvent.keyDown(field, { key: 'Tab' });
    const line = await waitFor(
      () => view.getByRole('combobox', { name: 'Command line' }) as HTMLInputElement,
    );
    expect(line.value).toBe('sort.modified');
  });
  it('reopens a recent request and its answer without another model call, and clears only request history', async () => {
    viewer.providerPermissionGet.mockResolvedValue({
      providerID: 'claude',
      kind: provider.kind,
      endpoint: new URL(provider.endpoint).href.replace(/\/+$/, ''),
      level: 'names',
    });
    const first = show();
    fireEvent.change(first.view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: '>sort by year' },
    });
    const field = await waitFor(() => first.view.getByRole('combobox', { name: 'Ask in words' }));
    await waitFor(() => first.view.getByRole('option', { name: /Ask: sort by year/ }));
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => first.view.getByRole('option', { name: /Newest first/ }));
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(getState().saved.promptHistory?.[0]).toMatchObject({
      prompt: 'sort by year',
      line: 'sort.modified',
    });
    first.view.unmount();
    const second = show();
    fireEvent.change(second.view.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: '>' },
    });
    const recent = await waitFor(() => second.view.getByRole('option', { name: /sort by year/ }));
    fireEvent.click(recent);
    await waitFor(() => second.view.getByRole('option', { name: /Newest first/ }));
    expect(viewer.promptLine).toHaveBeenCalledTimes(1);
    fireEvent.click(second.view.getByRole('button', { name: 'Clear recent requests' }));
    expect(getState().saved.promptHistory).toEqual([]);
    expect(getState().saved.lineHistory).toEqual(['sort.modified']);
  });
});

describe('sorting', () => {
  it('sorts a folder by a key, newest first; again the other way', () => {
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    const pane = () => activeWorkspace().panes[0]!;
    const sort = columnCommands().find((command) => command.id === 'sort.modified')!;
    const at = () => ({ folder: pane(), scope: 'folder' }) as unknown as CommandContext;
    act(() => void sort.run(at()));
    expect(pane()).toMatchObject({ sort: 'modified', descending: true });
    act(() => void sort.run(at()));
    expect(pane()).toMatchObject({ sort: 'modified', descending: false });
  });
});
