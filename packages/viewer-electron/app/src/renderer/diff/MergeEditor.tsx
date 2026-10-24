import { createContext, useContext, useEffect, useRef } from 'react';
import { EditorSelection, EditorState, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  redo,
  selectAll,
  undo,
} from '@codemirror/commands';
import { search, openSearchPanel } from '@codemirror/search';
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge';
import type { TextEditorProps } from '../previews/editor/TextEditor';
import { editorPresentation, editorTokens } from '../previews/editor/TextEditor';
import { syntaxHighlighting } from '@codemirror/language';
import { editorFont } from '../editing/font';
import { editorLanguages } from '../previews/editor/languages';
import { trimTrailingWhitespace } from '../../domain/editing/documents';
import { report } from '../state/store';

export interface DiffNavigation {
  next(): void;
  previous(): void;
}

export const MergeContext = createContext<{
  original: string;
  mode: 'split' | 'unified';
  editable: boolean;
  navigation: { current: DiffNavigation | null };
}>({ original: '', mode: 'split', editable: false, navigation: { current: null } });

/** Mode changes preserve the right document's selection and CodeMirror history field. */
export default function MergeEditor(props: TextEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const previous = useRef<EditorState | undefined>(undefined);
  const callbacks = useRef(props);
  callbacks.current = props;
  const { original, mode, editable, navigation } = useContext(MergeContext);

  useEffect(() => {
    if (!host.current) return;
    const retained = previous.current;
    const retainedHistory = retained?.field(historyField);
    const text = retained?.sliceDoc() ?? props.text;
    const extensions = [
      history(),
      ...(retainedHistory ? [historyField.init(() => retainedHistory)] : []),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      ...editorPresentation(props.settings),
      syntaxHighlighting(editorTokens),
      search(),
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
      EditorState.lineSeparator.of(text.includes('\r\n') ? '\r\n' : '\n'),
      EditorView.contentAttributes.of({ 'aria-label': props.label }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.current.onChange();
      }),
    ];
    let merged: MergeView | undefined;
    let view: EditorView;
    if (mode === 'split') {
      merged = new MergeView({
        parent: host.current,
        a: {
          doc: original,
          extensions: [
            ...editorPresentation(props.settings),
            syntaxHighlighting(editorTokens),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
          ],
        },
        b: { doc: text, selection: retained?.selection, extensions },
      });
      view = merged.b;
    } else {
      view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: text,
          selection: retained?.selection,
          extensions: [...extensions, unifiedMergeView({ original, mergeControls: false })],
        }),
      });
    }
    let live = true;
    if (props.language) {
      void editorLanguages[props.language]?.()
        .then((language) => {
          if (live && language) {
            // Language support is optional; the comparison remains usable while it loads.
            view.dispatch({ effects: StateEffect.appendConfig.of(language) });
            merged?.a.dispatch({ effects: StateEffect.appendConfig.of(language) });
          }
        })
        .catch(report);
    }
    navigation.current = {
      next: () => {
        goToNextChunk(view);
        view.focus();
      },
      previous: () => {
        goToPreviousChunk(view);
        view.focus();
      },
    };
    callbacks.current.onHandle({
      undo: () => undo(view),
      redo: () => redo(view),
      selectAll: () => selectAll(view),
      find: () => {
        openSearchPanel(view);
      },
      focus: () => view.focus(),
      hasFocus: () => view.hasFocus,
      text: () => view.state.sliceDoc(),
      trimTrailingWhitespace: () => {
        const current = view.state.sliceDoc();
        const trimmed = trimTrailingWhitespace(current);
        if (trimmed !== current)
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: trimmed },
            selection: EditorSelection.cursor(
              Math.min(view.state.selection.main.head, trimmed.length),
            ),
            annotations: Transaction.userEvent.of('input'),
          });
      },
    });
    return () => {
      live = false;
      previous.current = view.state;
      callbacks.current.onFinal?.(view.state.sliceDoc());
      callbacks.current.onHandle(null);
      navigation.current = null;
      if (merged) merged.destroy();
      else view.destroy();
    };
    // Document ownership stays with FileEditor; a new source is a new component key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, mode, editable, navigation, props.settings, props.language]);

  return (
    <div className="diff-text-editor text-editor" ref={host} style={editorFont(props.settings)} />
  );
}
