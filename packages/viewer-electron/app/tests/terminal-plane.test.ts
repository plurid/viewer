// @vitest-environment jsdom
/**
 * THE TERMINAL PLANE (2026-10-23): find lives in the plane's header (no row of its own, so opening it
 * shifts nothing), searches as it is typed with next and previous and a count, opens with ⌘F, and
 * the text is set by Settings → Terminals, by default the owner's iTerm profile.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { TerminalPane } from '../src/domain/contracts';

const fake = vi.hoisted(() => ({ session: undefined as unknown as Record<string, unknown> }));
vi.mock('../src/renderer/terminals/sessions', () => ({
  terminalSession: async () => fake.session,
  trimTerminals: () => {},
}));
import { TerminalPlane } from '../src/renderer/terminals/TerminalPlane';
import { openTerminalFind } from '../src/renderer/terminals/find';
import { setPreviewControlsSlot } from '../src/renderer/previews/controls';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { getState, initialize, receiveSettings } from '../src/renderer/state/store';

let results: ((event: { resultIndex: number; resultCount: number }) => void) | undefined;
beforeEach(() => {
  results = undefined;
  const element = document.createElement('div');
  fake.session = {
    terminal: { options: {}, cols: 80, rows: 24, focus: vi.fn(), paste: vi.fn() },
    fit: { fit: vi.fn() },
    search: {
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
      onDidChangeResults: (listener: typeof results) => {
        results = listener;
        return { dispose: () => {} };
      },
    },
    element,
    started: true,
    exited: false,
    disposed: false,
    input: '',
    attach: (container: HTMLElement) => container.append(element),
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(() => {
  cleanup();
  setPreviewControlsSlot('terminal', null);
  vi.unstubAllGlobals();
});
const pane = {
  id: 'terminal',
  type: 'terminal',
  path: '/fixtures',
  profileID: 'zsh',
} as TerminalPane;
const workspace = { rootID: () => 'terminal' } as unknown as WorkspaceController;
const show = () => {
  const header = document.createElement('div');
  document.body.append(header);
  setPreviewControlsSlot('terminal', header);
  const view = render(
    createElement(
      WorkspaceContext.Provider,
      { value: workspace },
      createElement(TerminalPlane, { pane }),
    ),
  );
  return { view, header };
};
const terminal = () => fake.session.terminal as { options: Record<string, unknown> };
const search = () => fake.session.search as Record<string, ReturnType<typeof vi.fn>>;

it('keeps find in the header, with no row of its own in the plane', async () => {
  const { view, header } = show();
  await waitFor(() =>
    expect(header.querySelector('[aria-label="Find in terminal"]')).not.toBeNull(),
  );
  expect(view.container.querySelector('.terminal-search-control')).toBeNull();
  fireEvent.click(header.querySelector('[aria-label="Find in terminal"]')!);
  const field = header.querySelector<HTMLInputElement>('input[aria-label="Find in terminal"]')!;
  fireEvent.change(field, { target: { value: 'error' } });
  expect(search().findNext).toHaveBeenLastCalledWith(
    'error',
    expect.objectContaining({ incremental: true, decorations: expect.any(Object) }),
  );
  act(() => results?.({ resultIndex: 1, resultCount: 7 }));
  expect(header.textContent).toContain('2 / 7');
  fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
  expect(search().findPrevious).toHaveBeenCalledWith('error', expect.any(Object));
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(search().clearDecorations).toHaveBeenCalled();
  expect(header.querySelector('input')).toBeNull();
});
it('opens find with ⌘F from the terminal', async () => {
  const { header } = show();
  await waitFor(() =>
    expect(header.querySelector('[aria-label="Find in terminal"]')).not.toBeNull(),
  );
  act(() => {
    expect(openTerminalFind('terminal')).toBe(true);
  });
  expect(header.querySelector('input[aria-label="Find in terminal"]')).not.toBeNull();
  expect(openTerminalFind('another plane')).toBe(false);
});
it("sets the text from Settings, by default the owner's iTerm profile", async () => {
  show();
  await waitFor(() => expect(terminal().options.fontSize).toBe(17));
  expect(terminal().options).toMatchObject({
    fontFamily: '"Hack Nerd Font Mono", Menlo, Monaco, monospace',
    fontWeight: 'bold',
    lineHeight: 1.3,
    letterSpacing: 1,
  });
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  snapshot.settings.terminalFont = { ...snapshot.settings.terminalFont, fontSize: 14 };
  act(() => receiveSettings(snapshot));
  await waitFor(() => expect(terminal().options.fontSize).toBe(14));
  expect((fake.session.fit as { fit: ReturnType<typeof vi.fn> }).fit).toHaveBeenCalled();
});
it('paints the whole plane in the terminal background, so no frame or bar shows', async () => {
  const { view } = show();
  const plane = view.container.querySelector<HTMLElement>('.terminal-plane')!;
  await waitFor(() => expect(plane.style.getPropertyValue('--terminal-background')).toMatch(/^#/));
});
