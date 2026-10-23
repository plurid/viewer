import { useEffect, useRef } from 'react';
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
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import type { EditorHandle } from '../../editing/planes';
import type { ApplicationSettings } from '../../../domain/services';
import { editorLanguages } from './languages';
import { editorFont } from '../../editing/font';

/** Prism's token classes, so text reads and edits in the same colours, in both looks. */
const tokens = HighlightStyle.define([
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
const presentation = (settings: ApplicationSettings['editor']) => [
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
export default function TextEditor({
  text,
  language,
  label,
  settings,
  onChange,
  onFinal,
  onHandle,
}: {
  text: string;
  /** A language id from the highlighting table. */
  language?: string;
  label: string;
  settings: ApplicationSettings['editor'];
  onChange(): void;
  /** The text as the editor closes, so its owner keeps the last keystrokes. */
  onFinal?(text: string): void;
  onHandle(handle: EditorHandle | null): void;
}) {
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
  useEffect(() => {
    const crlf = initial.current.includes('\r\n');
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          ...(crlf ? [EditorState.lineSeparator.of('\r\n')] : []),
          configured.current.of(presentation(initialSettings.current)),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          syntaxHighlighting(tokens),
          languages.current.of([]),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current();
          }),
        ],
      }),
    });
    view.current = editor;
    onHandle({
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
    view.current?.dispatch({ effects: configured.current.reconfigure(presentation(settings)) });
  }, [settings]);
  return <div className="text-editor" ref={host} style={editorFont(settings)} />;
}
