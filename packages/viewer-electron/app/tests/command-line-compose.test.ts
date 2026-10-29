// @vitest-environment jsdom
/**
 * Composing lines: a person's commands, named as vim's :command (capitalised), from
 * this session's :alias or a sequence's name, taking words as $1… and $*; Keep saves them as
 * sequences; send-keys types into a terminal; palette rows show the line they are; an import asks
 * before risky lines.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { withArguments, LineError, quoteWord } from '../src/domain/command-line/lex';
import {
  keepAliases,
  emptySessionKeys,
  type SessionKeys,
} from '../src/domain/preferences/session-keys';
import { runLine } from '../src/renderer/command-line/run';
import type { LineHost } from '../src/renderer/command-line/host';
import { lineHint } from '../src/renderer/command-line/hints';
import { commandName } from '../src/renderer/command-line/names';
import { receiveSessionKeys } from '../src/renderer/keys/session';
import {
  CommandRegistry,
  type CommandContext,
  type ResolvedCommand,
} from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import {
  activeWorkspace,
  addTerminalPane,
  getState,
  initialize,
  receiveSettings,
} from '../src/renderer/state/store';
import { importChanges } from '../src/desktop/preferences/import-changes';
import { defaultSettings } from '../src/domain/services';
import type { CustomAction } from '../src/domain/automation/actions';

let session: SessionKeys;
const viewer = {
  save: vi.fn(async () => {}),
  sessionKeys: vi.fn(async () => session),
  sessionKeysSet: vi.fn(async (next: SessionKeys) => {
    session = next;
    return next;
  }),
  terminalWrite: vi.fn(async () => {}),
  stat: vi.fn(async (path: string) => ({ path, name: path.split('/').pop(), directory: false })),
};
let ran: string[];
beforeEach(() => {
  ran = [];
  session = emptySessionKeys;
  for (const method of Object.values(viewer)) method.mockClear();
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  receiveSessionKeys(emptySessionKeys);
});
const context = (): CommandContext =>
  ({
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: getState().activePane,
    selection: [],
    jobs: [],
    clipboard: null,
  }) as unknown as CommandContext;
const host = (): LineHost => {
  const registry = new CommandRegistry();
  registry.register('window', {
    context,
    definitions: () =>
      ['frame-all', 'dock', 'tile-split-right'].map((id) => ({
        id,
        label: id,
        group: 'Test',
        when: () => true,
        run: () => {
          ran.push(id);
        },
      })),
  });
  return {
    registry,
    workspace: { openPath: vi.fn(async () => {}) } as unknown as WorkspaceController,
    context,
    invoke: (id, remember) =>
      registry.invoke(id, {
        paneID: context().paneID,
        scope: 'window',
        context: context(),
        remember,
      }),
    newWorkspace: vi.fn(async () => {}),
    switchWorkspace: vi.fn(async () => {}),
    palette: vi.fn(),
  };
};

describe('a named line’s words', () => {
  it('go in as $1 to $9 and $*, each kept one word', () => {
    expect(withArguments('e $1 | tabnew $2', ['~/My Docs', 'Studio'], 'Dev')).toBe(
      'e ~/My\\ Docs | tabnew Studio',
    );
    expect(withArguments('mkdir $* | echo $$', ['a', 'b c'], 'Dev')).toBe('mkdir a b\\ c | echo $');
    expect(withArguments('vs $1', [], 'Dev')).toBe('vs ');
    expect(() => withArguments('frame-all', ['x'], 'Dev')).toThrow(LineError);
  });
});

describe('a person’s command', () => {
  it('runs this session’s alias, its words in it', async () => {
    const live = host();
    expect((await runLine('command Fit frame-all | dock', live)).ok).toBe(true);
    expect(session.aliases).toEqual([{ name: 'Fit', line: 'frame-all | dock' }]);
    expect(await runLine('Fit', live)).toEqual({ ok: true });
    expect(ran).toEqual(['frame-all', 'dock']);
    await runLine('alias Open e $1', live);
    // the words go in quoted: a name with a space stays one path
    await runLine('Open ~/My\\ Docs/a.md', live);
    expect(live.workspace.openPath).toHaveBeenCalledWith(
      '/fixtures/My Docs/a.md',
      expect.objectContaining({ edit: true }),
    );
  });
  it('runs a sequence named so in Settings, and an :unalias hides it', async () => {
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.customActions = [
      {
        id: 'tidy',
        name: 'Tidy',
        aliases: [],
        icon: 'command',
        shortcut: '',
        order: 0,
        pinned: false,
        when: { target: 'any', extensions: [], min: 0, max: 10000 },
        executor: {
          kind: 'sequence',
          commands: ['frame-all', 'tile-split-right'],
          command: 'Tidy',
        },
      },
    ];
    act(() => receiveSettings(snapshot));
    const live = host();
    expect(await runLine('2 Tidy', live)).toEqual({ ok: true });
    expect(ran).toEqual(['frame-all', 'tile-split-right', 'frame-all', 'tile-split-right']);
    await runLine('unalias Tidy', live);
    expect((await runLine('Tidy', live)).message).toBe('No command :Tidy.');
  });
  it('says where a named line goes wrong, and stops one that calls itself', async () => {
    const live = host();
    await runLine('alias Bad frame-al', live);
    expect((await runLine('Bad', live)).message).toBe(
      ':Bad: Not a command: frame-al — did you mean frame-all?',
    );
    await runLine('alias Loop Loop', live);
    expect((await runLine('Loop', live)).message).toMatch(/too deeply/);
    expect((await runLine('alias lower q', live)).message).toMatch(/starts with a capital/);
  });
});

describe('keeping a session’s commands', () => {
  it('as sequences: a new name new, a known one changed, a forgotten one removed', () => {
    const sequence = (name: string, commands: string[]): CustomAction => ({
      id: name.toLowerCase(),
      name,
      aliases: [],
      icon: 'command',
      shortcut: '',
      order: 3,
      pinned: false,
      when: { target: 'any', extensions: [], min: 0, max: 10000 },
      executor: { kind: 'sequence', commands, command: name },
    });
    const kept = keepAliases(
      [sequence('Old', ['q']), sequence('Gone', ['dock'])],
      {
        bindings: [],
        aliases: [
          { name: 'Dev', line: 'cd ~/Developer | vs' },
          { name: 'Old', line: 'frame-all' },
          { name: 'Gone', line: null },
        ],
      },
      1,
    );
    expect(kept.map((action) => [action.name, action.executor])).toEqual([
      ['Old', { kind: 'sequence', commands: ['frame-all'], command: 'Old' }],
      ['Dev', { kind: 'sequence', commands: ['cd ~/Developer | vs'], command: 'Dev' }],
    ]);
    expect(kept[1]).toMatchObject({ id: 'command-dev-1', order: 4 });
  });
});

describe('send-keys', () => {
  it('types words as text and key names as keys into the terminal plane', async () => {
    let pane!: ReturnType<typeof addTerminalPane>;
    act(() => {
      pane = addTerminalPane('/fixtures', 'zsh', true);
    });
    expect(await runLine("send-keys 'ls -la' Enter C-c M-x Tab", host())).toEqual({ ok: true });
    expect(viewer.terminalWrite).toHaveBeenCalledWith(pane.id, 'ls -la\r\u0003\u001bx\t');
  });
  it('types only into a terminal plane', async () => {
    expect((await runLine('send-keys hello', host())).message).toMatch(/terminal plane/);
  });
});

describe('a palette row’s line', () => {
  const row = (id: string, label = id) => ({ id, label }) as ResolvedCommand;
  it('is the verb, the set, the colorscheme or the workspace it is', () => {
    expect(lineHint(row('close-plane'))).toBe('q');
    expect(lineHint(row('tile-split-right'))).toBe('vs');
    expect(lineHint(row('setting.ui.space.grid'))).toBe('set grid!');
    expect(lineHint(row('setting.ui.space.minimap@workspace'))).toBe('setl minimap!');
    expect(lineHint(row('setting.ui.space.backdrop=blur'))).toBe('set backdrop=blur');
    expect(lineHint(row('setting.ui.space.backdropOpacity'))).toBe('set opacity=');
    expect(lineHint(row('theme.night-1', 'Theme: Night Owl'))).toBe("colo 'Night Owl'");
    expect(lineHint(row(`workspace:${activeWorkspace().id}`))).toBe(
      `tabn ${quoteWord(activeWorkspace().name)}`,
    );
    expect(lineHint(row('frame-all'))).toBeUndefined();
  });
});

describe('an imported configuration', () => {
  it('asks first when keys or sequences would type into terminals, trash or drop text', () => {
    const current = defaultSettings('/fixtures');
    const next = structuredClone(current);
    next.keymap.root = { 'Alt+q': 'qa!' };
    expect(importChanges(current, next)).toEqual([
      'keys and sequences that type into terminals, move files to the Trash, rename them or drop unsaved text',
    ]);
    const harmless = structuredClone(current);
    harmless.keymap.root = { 'Alt+v': 'vs ~/Documents' };
    expect(importChanges(current, harmless)).toEqual([]);
  });
});

describe('a macro’s command name', () => {
  it('is its name in capitals, run together', () => {
    expect(commandName('open docs')).toBe('OpenDocs');
    expect(commandName('Macro')).toBe('Macro');
    expect(commandName('3 views')).toBeUndefined();
    expect(commandName('—')).toBeUndefined();
  });
});
