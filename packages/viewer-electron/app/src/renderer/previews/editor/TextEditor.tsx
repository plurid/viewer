import { useCallback, useEffect, useRef, useState } from 'react';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  search,
  selectNextOccurrence,
  selectSelectionMatches,
} from '@codemirror/search';
import type { Command } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { EditorHandle } from '../../editing/planes';
import type { ApplicationSettings } from '../../../domain/services';
import { editorLanguages } from './languages';
import { editorFont } from '../../editing/font';
import { findMarks, findOpen, showFind } from './find';
import { EditorFind, type FindRequest } from './EditorFind';

/** Prism's token classes, so text reads and edits in the same colours, in both looks. */
export const editorTokens = HighlightStyle.define([
  { tag: [tags.comment, tags.meta, tags.processingInstruction], class: 'token comment' },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue, tags.url],
    class: 'token string',
  },
  {
    tag: [tags.keyword, tags.modifier, tags.bool, tags.null, tags.self, tags.operatorKeyword],
    class: 'token keyword',
  },
  { tag: [tags.number, tags.atom, tags.constant(tags.name), tags.unit], class: 'token number' },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.tagName,
      tags.heading,
      tags.typeName,
      tags.className,
    ],
    class: 'token function',
  },
  { tag: tags.invalid, class: 'token invalid' },
]);

/** What the editor settings configure in CodeMirror; the font is CSS, set on the host. */
export const editorPresentation = (settings: ApplicationSettings['editor']) => [
  ...(settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
  EditorState.tabSize.of(settings.tabSize),
  indentUnit.of(settings.insertSpaces ? ' '.repeat(settings.tabSize) : '\t'),
  ...(settings.wordWrap ? [EditorView.lineWrapping] : []),
];
/**
 * EDITING TEXT (2026-10-23). A CodeMirror editor, loaded only when a plane edits text. It keeps the
 * file's line breaks (`\r\n` stays `\r\n`) and tells its owner when the text changes; the owner reads
 * it through the handle, so a large file is not copied on every keystroke.
 */
export interface TextEditorProps {
  text: string;
  language?: string;
  label: string;
  settings: ApplicationSettings['editor'];
  onChange(): void;
  onFinal?(text: string): void;
  onHandle(handle: EditorHandle | null): void;
}

export default function TextEditor({
  text,
  language,
  label,
  settings,
  onChange,
  onFinal,
  onHandle,
}: TextEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languages = useRef(new Compartment());
  const configured = useRef(new Compartment());
  // the settings at creation; later changes reconfigure the editor in place
  const initialSettings = useRef(settings);
  const changed = useRef(onChange);
  changed.current = onChange;
  const finished = useRef(onFinal);
  finished.current = onFinal;
  // the initial text only: the owner remounts the editor to load another
  const initial = useRef(text);
  // Viewer's find over the text (EditorFind), opened by ⌘F, ⌥⌘F or the handle
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [find, setFind] = useState<FindRequest | null>(null);
  const findListeners = useRef(new Set<() => void>());
  const subscribe = useCallback((listener: () => void) => {
    findListeners.current.add(listener);
    return () => {
      findListeners.current.delete(listener);
    };
  }, []);
  const openFind = useRef((replace: boolean) => {
    const editor = view.current;
    if (!editor) return;
    const { from, to } = editor.state.selection.main;
    const selected = editor.state.sliceDoc(from, to);
    setFind((open) => ({
      replace: replace || !!open?.replace,
      nonce: (open?.nonce ?? 0) + 1,
      // the selected text becomes the query, when it is one line
      initial: selected && !selected.includes('\n') ? selected : undefined,
    }));
  });
  const closeFind = useCallback(() => {
    view.current?.dispatch({ effects: showFind.of(false) });
    setFind(null);
    view.current?.focus();
  }, []);
  useEffect(() => {
    const crlf = initial.current.includes('\r\n');
    // ⌘G and F3 step through the last query, or open find when there is none
    const step =
      (command: Command): Command =>
      (editor) => {
        if (getSearchQuery(editor.state).valid) return command(editor);
        openFind.current(false);
        return true;
      };
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          ...(crlf ? [EditorState.lineSeparator.of('\r\n')] : []),
          configured.current.of(editorPresentation(initialSettings.current)),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          // the search state and commands only: CodeMirror's own panel is never opened
          search({ createPanel: () => ({ dom: document.createElement('div') }) }),
          findMarks,
          syntaxHighlighting(editorTokens),
          languages.current.of([]),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          keymap.of([
            {
              key: 'Mod-f',
              run: () => {
                openFind.current(false);
                return true;
              },
            },
            {
              key: 'Mod-Alt-f',
              run: () => {
                openFind.current(true);
                return true;
              },
            },
            { key: 'Mod-g', run: step(findNext), shift: step(findPrevious), preventDefault: true },
            { key: 'F3', run: step(findNext), shift: step(findPrevious), preventDefault: true },
            { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
            { key: 'Mod-Shift-l', run: selectSelectionMatches },
            {
              key: 'Escape',
              run: (editor) => {
                if (!findOpen(editor.state)) return false;
                closeFind();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current();
            if (
              findListeners.current.size &&
              (update.docChanged ||
                update.selectionSet ||
                update.transactions.some((transaction) => transaction.effects.length))
            )
              for (const listener of findListeners.current) listener();
          }),
        ],
      }),
    });
    view.current = editor;
    setEditorView(editor);
    onHandle({
      find: () => openFind.current(false),
      undo: () => undo(editor),
      redo: () => redo(editor),
      selectAll: () => {
        editor.dispatch({ selection: EditorSelection.single(0, editor.state.doc.length) });
        return true;
      },
      focus: () => editor.focus(),
      hasFocus: () => editor.hasFocus,
      text: () => editor.state.sliceDoc(),
      trimTrailingWhitespace: () => {
        const changes = [];
        for (let number = 1; number <= editor.state.doc.lines; number++) {
          const line = editor.state.doc.line(number);
          const trailing = /[ \t]+$/.exec(line.text);
          if (trailing) changes.push({ from: line.from + trailing.index, to: line.to });
        }
        if (changes.length) editor.dispatch({ changes });
      },
    });
    return () => {
      finished.current?.(editor.state.sliceDoc());
      onHandle(null);
      view.current = null;
      setEditorView(null);
      editor.destroy();
    };
    // the label and handle callback are fixed for an editor's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let live = true;
    const load = language ? editorLanguages[language] : null;
    void (load ? load() : Promise.resolve([]))
      .then((extension) => {
        if (live) view.current?.dispatch({ effects: languages.current.reconfigure(extension) });
      })
      .catch(() => {
        // a language that fails to load edits as plain text
      });
    return () => {
      live = false;
    };
  }, [language]);
  useEffect(() => {
    view.current?.dispatch({
      effects: configured.current.reconfigure(editorPresentation(settings)),
    });
  }, [settings]);
  return (
    <div className="text-editor-frame">
      <div className="text-editor" ref={host} style={editorFont(settings)} />
      {find && editorView && (
        <EditorFind view={editorView} request={find} subscribe={subscribe} onClose={closeFind} />
      )}
    </div>
  );
}
