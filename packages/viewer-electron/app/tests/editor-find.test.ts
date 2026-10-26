// @vitest-environment jsdom
/**
 * Find in text: ⌘F in an editor opens Viewer's own find over the text's top right, as
 * an editor's find widget, in place of CodeMirror's panel (native buttons, a band pushing the text
 * down). It finds as typed, counts, steps, matches case, whole words or patterns, and replaces.
 */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { EditorView } from '@codemirror/view';
import TextEditor from '../src/renderer/previews/editor/TextEditor';
import type { EditorHandle } from '../src/renderer/editing/planes';
import { defaultSettings } from '../src/domain/services';

beforeAll(() => {
  // CodeMirror measures text through ranges, which jsdom does not lay out
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList;
});
afterEach(cleanup);

const text = 'alpha beta alpha\nAlpha gamma';
async function show() {
  let handle: EditorHandle | null = null;
  const view = render(
    createElement(TextEditor, {
      text,
      label: 'Edit notes',
      settings: defaultSettings('/fixtures').editor,
      onChange: vi.fn(),
      onHandle: (value: EditorHandle | null) => {
        handle = value;
      },
    }),
  );
  await waitFor(() => expect(view.container.querySelector('.cm-editor')).not.toBeNull());
  const cm = EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)!;
  const field = () => view.getByRole('textbox', { name: 'Find' }) as HTMLInputElement;
  const count = () => view.container.querySelector('.editor-find-count')?.textContent;
  return { view, cm, field, count, handle: () => handle! };
}
// jsdom is no Mac: CodeMirror's Mod is Ctrl there
const modF = (cm: EditorView) => fireEvent.keyDown(cm.contentDOM, { key: 'f', ctrlKey: true });

it('opens over the text with ⌘F, the selection as its query, and no CodeMirror panel', async () => {
  const { view, cm, field, count } = await show();
  act(() => cm.dispatch({ selection: { anchor: 0, head: 5 } }));
  modF(cm);
  await waitFor(() => expect(field().value).toBe('alpha'));
  expect(view.container.querySelector('.cm-search, .cm-panel')).toBeNull();
  expect(view.container.querySelector('.editor-find')).not.toBeNull();
  await waitFor(() => expect(count()).toBe('1 / 3'));
});
it('finds as it is typed, and steps with Enter and Shift+Enter', async () => {
  const { cm, field, count, handle } = await show();
  act(() => handle().find());
  fireEvent.change(field(), { target: { value: 'gam' } });
  await waitFor(() => expect(count()).toBe('1 / 1'));
  expect(cm.state.selection.main.from).toBe(text.indexOf('gam'));
  fireEvent.change(field(), { target: { value: 'alpha' } });
  await waitFor(() => expect(count()).toMatch(/ \/ 3$/));
  const first = count();
  fireEvent.keyDown(field(), { key: 'Enter' });
  await waitFor(() => expect(count()).not.toBe(first));
  fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
  await waitFor(() => expect(count()).toBe(first));
});
it('matches case, whole words and patterns, and says when nothing or an invalid pattern', async () => {
  const { view, field, count, handle } = await show();
  act(() => handle().find());
  fireEvent.change(field(), { target: { value: 'alpha' } });
  await waitFor(() => expect(count()).toMatch(/3$/));
  fireEvent.click(view.getByRole('button', { name: 'Match case' }));
  await waitFor(() => expect(count()).toMatch(/2$/));
  expect(view.getByRole('button', { name: 'Match case' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.change(field(), { target: { value: 'alph' } });
  fireEvent.click(view.getByRole('button', { name: 'Whole word' }));
  await waitFor(() => expect(count()).toBe('No matches'));
  fireEvent.click(view.getByRole('button', { name: 'Whole word' }));
  fireEvent.click(view.getByRole('button', { name: 'Regular expression' }));
  fireEvent.change(field(), { target: { value: 'al(' } });
  await waitFor(() => expect(count()).toBe('Invalid pattern'));
});
it('replaces one match or all of them, as one undoable edit each', async () => {
  const { view, cm, field, count, handle } = await show();
  act(() => handle().find());
  fireEvent.click(view.getByRole('button', { name: 'Toggle replace' }));
  fireEvent.click(view.getByRole('button', { name: 'Match case' }));
  fireEvent.change(field(), { target: { value: 'alpha' } });
  fireEvent.change(view.getByRole('textbox', { name: 'Replace' }), {
    target: { value: 'omega' },
  });
  // the buttons wait for the count: nothing to replace is no button to press
  await waitFor(() => expect(count()).toMatch(/2$/));
  fireEvent.click(view.getByRole('button', { name: 'Replace all' }));
  await waitFor(() => expect(cm.state.sliceDoc()).toBe('omega beta omega\nAlpha gamma'));
});
it('closes with Escape, back to the text, with no matches left marked', async () => {
  const { view, cm, field, handle } = await show();
  act(() => handle().find());
  fireEvent.change(field(), { target: { value: 'alpha' } });
  fireEvent.keyDown(field(), { key: 'Escape' });
  await waitFor(() => expect(view.container.querySelector('.editor-find')).toBeNull());
  expect(view.container.querySelector('.cm-find-match')).toBeNull();
  // ⌘F opens it again, keeping the last query
  modF(cm);
  await waitFor(() => expect(field().value).toBe('alpha'));
});
