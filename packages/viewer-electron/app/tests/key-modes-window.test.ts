// @vitest-environment jsdom
/**
 * KEYS THAT SPEAK LINES, IN THE WINDOW (2026-10-23): a root key needs no prefix and leaves text
 * fields alone; a mode keeps its keys until Escape, counting digits; a repeat key comes again
 * without the prefix; `:bind`, `:unbind` and `:mode`; a macro records lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { getState, initialize, receiveSettings } from '../src/renderer/state/store';
import { enterKeyMode, useKeySequences } from '../src/renderer/keys/sequences';
import { effectiveKeymap, receiveSessionKeys } from '../src/renderer/keys/session';
import { WhichKey } from '../src/renderer/keys/WhichKey';
import { recordCommand, recordLine, startMacro, stopMacro } from '../src/renderer/keys/macro';
import { runLine } from '../src/renderer/command-line/run';
import type { LineHost } from '../src/renderer/command-line/host';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { emptySessionKeys, type SessionKeys } from '../src/domain/session-keys';
import type { Keymap } from '../src/domain/keymap';
import { quoteWord } from '../src/domain/command-line/lex';

let session: SessionKeys;
const sessionKeysSet = vi.fn(async (next: SessionKeys) => {
  session = next;
  return next;
});
beforeEach(() => {
  vi.useFakeTimers();
  session = emptySessionKeys;
  sessionKeysSet.mockClear();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      sessionKeys: vi.fn(async () => session),
      sessionKeysSet,
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  receiveSessionKeys(emptySessionKeys);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
const press = (target: Element, key: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};
const keymap = (change: Partial<Keymap>) => {
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  snapshot.settings.keymap = { ...snapshot.settings.keymap, ...change };
  act(() => receiveSettings(snapshot));
};
const setup = () => {
  const run = vi.fn(async () => {});
  renderHook(() => useKeySequences(run));
  return run;
};

describe('a root key', () => {
  it('runs its line without the prefix, and leaves text fields their keys', async () => {
    keymap({ root: { 'M-h': 'focus-left' } });
    const run = setup();
    expect(press(document.body, '˙', { altKey: true, code: 'KeyH' }).defaultPrevented).toBe(true);
    await act(async () => {});
    expect(run).toHaveBeenCalledWith(['focus-left'], 1);
    const field = document.body.appendChild(document.createElement('input'));
    expect(press(field, '˙', { altKey: true, code: 'KeyH' }).defaultPrevented).toBe(false);
  });
});

describe('a mode', () => {
  it('keeps its keys until Escape, a count before a key running it that often', async () => {
    const run = setup();
    const view = render(createElement(WhichKey, { label: () => undefined }));
    act(() => void enterKeyMode('resize'));
    expect(view.container.textContent).toContain('-- RESIZE --');
    press(document.body, '3');
    press(document.body, 'l');
    await act(async () => {});
    expect(run).toHaveBeenCalledWith(['tile-resize-right'], 3);
    // a key the mode does not bind is taken, said, and the mode stays
    expect(press(document.body, 'x').defaultPrevented).toBe(true);
    expect(view.container.textContent).toContain('-- RESIZE --');
    press(document.body, 'Escape');
    expect(view.container.textContent).not.toContain('RESIZE');
    expect(press(document.body, 'l').defaultPrevented).toBe(false);
  });
  it('is entered by prefix R, a line binding it', async () => {
    const run = setup();
    press(document.body, 'b', { ctrlKey: true });
    press(document.body, 'R', { shiftKey: true });
    await act(async () => {});
    expect(run).toHaveBeenCalledWith(['mode resize'], 1);
  });
});

describe('a repeat key', () => {
  it('comes again without the prefix for a moment; another key is the window’s', async () => {
    const run = setup();
    press(document.body, 'b', { ctrlKey: true });
    press(document.body, '+', { shiftKey: true });
    expect(press(document.body, '+', { shiftKey: true }).defaultPrevented).toBe(true);
    await act(async () => {});
    expect(run).toHaveBeenCalledTimes(2);
    expect(press(document.body, 'x').defaultPrevented).toBe(false);
  });
});

describe(':bind, :unbind and :mode', () => {
  const host = (): LineHost => {
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => ({ scope: 'window', selection: [] }) as unknown as CommandContext,
      definitions: () => [],
    });
    return {
      registry,
      workspace: {} as WorkspaceController,
      context: () => ({ scope: 'window', selection: [] }) as unknown as CommandContext,
      invoke: vi.fn(async () => true),
      newWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      palette: vi.fn(),
    };
  };
  it('bind for the session: a root key, a line with bars, a repeat key; unbind removes', async () => {
    const live = host();
    expect((await runLine('bind -n M-h select-pane -L', live)).ok).toBe(true);
    expect((await runLine('bind % vs | e ~', live)).ok).toBe(true);
    expect((await runLine('bind -r x tile-main-grow', live)).ok).toBe(true);
    expect((await runLine('unbind c', live)).ok).toBe(true);
    expect(session.bindings).toEqual([
      { table: 'root', keys: ['Alt+h'], line: 'select-pane -L' },
      { table: 'prefix', keys: ['%'], line: 'vs | e ~' },
      { table: 'prefix', keys: ['x'], line: 'tile-main-grow', repeat: true },
      { table: 'prefix', keys: ['c'], line: null },
    ]);
    const effective = effectiveKeymap();
    expect(effective.root['Alt+h']).toBe('select-pane -L');
    expect(effective.bindings['%']).toBe('vs | e ~');
    expect(effective.repeat).toContain('x');
    expect(effective.bindings).not.toHaveProperty('c');
    // config.jsonc is not changed: Settings keeps a session's bindings
    expect(getState().settings.settings.keymap.bindings).toHaveProperty('c');
  });
  it('refuses a key without the prefix that typing would take, and a broken line', async () => {
    const live = host();
    expect((await runLine('bind -n h q', live)).message).toMatch(/needs ⌃, ⌥ or ⌘/);
    expect((await runLine("bind x e 'open", live)).message).toMatch(/quote/);
    expect(sessionKeysSet).not.toHaveBeenCalled();
  });
  it('enters a mode by name, and says when there is none', async () => {
    setup();
    const view = render(createElement(WhichKey, { label: () => undefined }));
    expect((await runLine('mode resize', host())).ok).toBe(true);
    expect(view.container.textContent).toContain('-- RESIZE --');
    expect((await runLine('mode resise', host())).message).toBe(
      'No mode “resise” — did you mean resize?',
    );
  });
});

describe('a macro', () => {
  it('records lines as written, and a workspace by its name', () => {
    const [workspace] = getState().saved.workspaces;
    startMacro();
    recordLine('vs ~/Documents');
    recordCommand(`workspace:${workspace!.id}`);
    recordLine('record-macro');
    recordCommand('frame-all');
    expect(stopMacro()).toEqual([
      'vs ~/Documents',
      `tabn ${quoteWord(workspace!.name)}`,
      'frame-all',
    ]);
  });
});
