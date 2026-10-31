import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search';
import { IconButton } from '../../ui/primitives';
import { findStatus, selectFrom, showFind, type FindStatus } from './find';

/** What opened find: ⌘F (or ⌥⌘F, with Replace), and the selected text to find, if any. */
export interface FindRequest {
  replace: boolean;
  /** Changes with every ⌘F, so pressing it again selects the query. */
  nonce: number;
  initial?: string;
}
/**
 * Find in text: Viewer's find over the editor's top right, as an editor's find widget:
 * it covers the text rather than pushing it down. Finds as it is typed from where it opened, counts,
 * steps with Enter and Shift+Enter, matches case (⌥C), whole words (⌥W) or patterns (⌥R), and
 * replaces one match or all.
 */
export function EditorFind({
  view,
  request,
  subscribe,
  onClose,
}: {
  view: EditorView;
  request: FindRequest;
  /** Called on the editor's changes of text, selection or query. */
  subscribe(listener: () => void): () => void;
  onClose(): void;
}) {
  const last = getSearchQuery(view.state);
  const field = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(request.initial ?? last.search);
  const [caseSensitive, setCaseSensitive] = useState(last.caseSensitive);
  const [wholeWord, setWholeWord] = useState(last.wholeWord);
  const [regexp, setRegexp] = useState(last.regexp);
  const [replacing, setReplacing] = useState(request.replace);
  const [replacement, setReplacement] = useState(last.replace);
  const [status, setStatus] = useState<FindStatus | null>(null);
  // where finding as it is typed starts: where find opened, then where a step left it
  const origin = useRef(view.state.selection.main.from);
  useEffect(() => {
    if (request.initial !== undefined) setSearch(request.initial);
    if (request.replace) setReplacing(true);
    origin.current = view.state.selection.main.from;
    field.current?.focus();
    field.current?.select();
    // each ⌘F, not each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce]);
  useEffect(() => {
    view.dispatch({
      effects: [
        setSearchQuery.of(
          new SearchQuery({
            search,
            caseSensitive,
            wholeWord,
            regexp,
            replace: replacement,
            // only a pattern reads \n and \t as escapes
            literal: !regexp,
          }),
        ),
        showFind.of(true),
      ],
    });
  }, [view, search, caseSensitive, wholeWord, regexp, replacement]);
  useEffect(() => {
    if (search) selectFrom(view, origin.current);
  }, [view, search, caseSensitive, wholeWord, regexp]);
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setStatus(findStatus(view.state)));
    };
    refresh();
    const unsubscribe = subscribe(refresh);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [view, subscribe]);
  const valid = () => getSearchQuery(view.state).valid;
  const step = (forward: boolean) => {
    if (!valid()) return;
    if (forward) findNext(view);
    else findPrevious(view);
    origin.current = view.state.selection.main.from;
  };
  const options = (event: KeyboardEvent) => {
    // ⌥ changes the character on a Mac: the key's place, not its letter
    if (!event.altKey || event.metaKey || event.ctrlKey) return false;
    const toggle = { KeyC: setCaseSensitive, KeyW: setWholeWord, KeyR: setRegexp }[event.code];
    if (!toggle) return false;
    toggle((value) => !value);
    return true;
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>, enter: () => void) => {
    let handled = options(event);
    if (event.key === 'Enter') {
      enter();
      handled = true;
    } else if (event.key === 'Escape') {
      onClose();
      handled = true;
    } else if (event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)) {
      field.current?.select();
      handled = true;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const count = !search
    ? ''
    : !status
      ? 'Invalid pattern'
      : !status.count
        ? 'No matches'
        : status.index >= 0
          ? `${status.index + 1} / ${status.count}${status.capped ? '+' : ''}`
          : `${status.count}${status.capped ? '+' : ''} ${status.count === 1 ? 'match' : 'matches'}`;
  const found = !!status?.count;
  const option = (label: string, title: string, on: boolean, set: (value: boolean) => void) => (
    <button
      type="button"
      className="editor-find-option"
      aria-label={label}
      aria-pressed={on}
      title={title}
      onClick={() => set(!on)}
    >
      <span aria-hidden>
        {label === 'Match case' ? 'Aa' : label === 'Whole word' ? 'ab' : '.*'}
      </span>
    </button>
  );
  return (
    <div className="editor-find" role="search" aria-label="Find in text">
      <IconButton
        className="editor-find-disclosure"
        icon={replacing ? 'down' : 'right'}
        label="Toggle replace"
        aria-expanded={replacing}
        onClick={() => setReplacing((value) => !value)}
      />
      <div className="editor-find-rows">
        <div className="editor-find-row">
          <div className="editor-find-field">
            <input
              ref={field}
              aria-label="Find"
              placeholder="Find"
              spellCheck={false}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => keys(event, () => step(!event.shiftKey))}
            />
            {option('Match case', 'Match case (⌥C)', caseSensitive, setCaseSensitive)}
            {option('Whole word', 'Whole word (⌥W)', wholeWord, setWholeWord)}
            {option('Regular expression', 'Regular expression (⌥R)', regexp, setRegexp)}
          </div>
          <span
            className={'editor-find-count' + (search && !status ? ' is-invalid' : '')}
            aria-live="polite"
          >
            {count}
          </span>
          <IconButton
            icon="up"
            label="Previous match"
            disabled={!found}
            onClick={() => step(false)}
          />
          <IconButton icon="down" label="Next match" disabled={!found} onClick={() => step(true)} />
          <IconButton icon="close" label="Close find" onClick={onClose} />
        </div>
        {replacing && (
          <div className="editor-find-row">
            <div className="editor-find-field">
              <input
                aria-label="Replace"
                placeholder="Replace"
                spellCheck={false}
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                onKeyDown={(event) =>
                  keys(event, () => {
                    if (!valid()) return;
                    // ⌘Enter replaces them all
                    if (event.metaKey || event.ctrlKey) replaceAll(view);
                    else replaceNext(view);
                  })
                }
              />
            </div>
            <button
              type="button"
              className="button-secondary editor-find-action"
              disabled={!found}
              title="Replace (Enter)"
              onClick={() => valid() && replaceNext(view)}
            >
              Replace
            </button>
            <button
              type="button"
              className="button-secondary editor-find-action"
              aria-label="Replace all"
              disabled={!found}
              title="Replace all (⌘Enter)"
              onClick={() => valid() && replaceAll(view)}
            >
              All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
