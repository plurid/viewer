import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { getSearchQuery, setSearchQuery } from '@codemirror/search';

/**
 * FIND IN TEXT (2026-10-23): CodeMirror's search state and commands under Viewer's own find widget
 * (`EditorFind`). Its matches are marked here only while that widget is open; CodeMirror's panel,
 * which marks them otherwise, is never shown.
 */
export const showFind = StateEffect.define<boolean>();
const findShown = StateField.define<boolean>({
  create: () => false,
  update: (shown, transaction) =>
    transaction.effects.reduce(
      (value, effect) => (effect.is(showFind) ? (effect.value as boolean) : value),
      shown,
    ),
});
export const findOpen = (state: EditorState) => state.field(findShown, false) ?? false;

const match = Decoration.mark({ class: 'cm-find-match' });
const current = Decoration.mark({ class: 'cm-find-match cm-find-current' });
/** The matches in view, and a little around it, the selected one stronger. */
function marks(view: EditorView): DecorationSet {
  const { state } = view;
  const query = getSearchQuery(state);
  if (!findOpen(state) || !query.valid) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const selected = state.selection.main;
  let last = 0;
  for (const range of view.visibleRanges) {
    const from = Math.max(range.from - 250, last);
    const to = Math.min(range.to + 250, state.doc.length);
    if (from >= to) continue;
    const cursor = query.getCursor(state, from, to);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      const found = next.value;
      if (found.from === found.to || found.from < last) continue;
      builder.add(
        found.from,
        found.to,
        found.from === selected.from && found.to === selected.to ? current : match,
      );
      last = found.to;
    }
  }
  return builder.finish();
}
export const findMarks = [
  findShown,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = marks(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(showFind) || effect.is(setSearchQuery)),
          )
        )
          this.decorations = marks(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
];

/** Counting stops here: a count beyond it reads "9999+". */
const COUNT_LIMIT = 9999;
export interface FindStatus {
  /** The selected match's place, or -1 when the selection is no match. */
  index: number;
  count: number;
  capped: boolean;
}
/** How many matches the query has, and which the selection is; null for an invalid pattern. */
export function findStatus(state: EditorState): FindStatus | null {
  const query = getSearchQuery(state);
  if (!query.valid) return null;
  const selected = state.selection.main;
  const cursor = query.getCursor(state);
  let count = 0;
  let index = -1;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (next.value.from === selected.from && next.value.to === selected.to) index = count;
    if (++count >= COUNT_LIMIT) return { index, count, capped: true };
  }
  return { index, count, capped: false };
}

/** Selects the first match from `origin` on, wrapping to the start: finding as it is typed. */
export function selectFrom(view: EditorView, origin: number): void {
  const { state } = view;
  const query = getSearchQuery(state);
  if (!query.valid) return;
  let next = query.getCursor(state, Math.min(origin, state.doc.length)).next();
  if (next.done) next = query.getCursor(state, 0, Math.min(origin, state.doc.length)).next();
  if (next.done) return;
  view.dispatch({
    selection: { anchor: next.value.from, head: next.value.to },
    effects: EditorView.scrollIntoView(next.value.from, { y: 'center' }),
    userEvent: 'select.search',
  });
}
