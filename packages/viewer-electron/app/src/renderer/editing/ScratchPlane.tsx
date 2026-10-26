import { effectiveWindowSettings } from '../state/effective-ui';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScratchPane } from '../../domain/contracts';
import { textLanguages } from '../../domain/editing/languages';
import { Loading } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { usePreviewControlsSlot } from '../previews/controls';
import { getState, replacePane, report, updatePane, useViewer } from '../state/store';
import { discardBuffer, keepBuffer, readBuffer } from './buffers';
import { registerEditingPlane, type EditorHandle } from './planes';
import { continueEditing, sessionContinues, takeSession } from './sessions';
import { scratchFileName } from './unsaved';

const TextEditor = lazy(() => import('../previews/editor/TextEditor'));

/**
 * A scratch plane: text that is not a file yet, kept in the profile as it is typed, so a
 * quit or a crash keeps it. Save As writes it as a file (on the Desktop, or anywhere) and the plane
 * becomes that file's, in place, still editing it.
 */
export default function ScratchPlane({
  pane,
  visible,
}: {
  pane: ScratchPane;
  /** Shown on screen: a new plane is framed after it mounts, and a hidden one cannot take focus. */
  visible: boolean;
}) {
  const header = usePreviewControlsSlot(pane.id);
  const [initial, setInitial] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);
  const editor = useRef<EditorHandle | null>(null);
  const text = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const session = useMemo(() => takeSession(pane.id) ?? crypto.randomUUID(), [pane.id]);
  const settings = useViewer((state) => effectiveWindowSettings(state).editor);
  const current = useRef(pane);
  current.current = pane;
  // a plane made active (⌘T) takes the keys once it is shown; one restored at launch does not
  const shown = useRef(visible);
  shown.current = visible;
  const focused = useRef(false);
  const focusOnce = () => {
    if (focused.current || !shown.current || !editor.current) return;
    if (getState().activePane !== current.current.id) return;
    focused.current = true;
    editor.current.focus();
  };
  useEffect(focusOnce, [visible]);
  useEffect(() => {
    let live = true;
    void readBuffer(pane.bufferID)
      .then((buffer) => {
        text.current = buffer?.text ?? '';
        if (live) {
          setInitial(text.current);
          setEmpty(!text.current);
        }
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [pane.bufferID]);
  useEffect(
    () => () => {
      if (!sessionContinues(pane.id, session))
        void window.viewer.textEditEnd(session).catch(report);
    },
    [pane.id, session],
  );
  const keep = (value: string) => {
    text.current = value;
    setEmpty(!value);
    const { bufferID, title, language } = current.current;
    keepBuffer({ id: bufferID, kind: 'scratch', title, language, text: value });
  };
  const changed = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      keep(editor.current?.text() ?? text.current);
    }, 250);
  };
  const final = (value: string) => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    keep(value);
  };
  const saveAs = async (suggested?: string): Promise<boolean> => {
    const { id, bufferID, title, language } = current.current;
    if (effectiveWindowSettings(getState()).editor.trimTrailingWhitespace)
      editor.current?.trimTrailingWhitespace();
    const value = editor.current?.text() ?? text.current;
    const result = await window.viewer.textSaveAs(
      value,
      suggested ?? scratchFileName(title ?? 'Untitled', language),
      session,
    );
    if (!result) return false;
    clearTimeout(timer.current);
    timer.current = undefined;
    await discardBuffer(bufferID);
    // the plane becomes the new file's, in place, still edited in this session
    continueEditing(id, session);
    replacePane(id, { id, type: 'preview', path: result.file });
    return true;
  };
  const actions = useRef({ saveAs });
  actions.current = { saveAs };
  useEffect(
    () =>
      registerEditingPlane(pane.id, {
        save: () => actions.current.saveAs(),
        saveAs: (suggested) => actions.current.saveAs(suggested),
        dirty: () => !!(editor.current?.text() ?? text.current),
        discard: async () => {
          clearTimeout(timer.current);
          timer.current = undefined;
          await discardBuffer(current.current.bufferID);
        },
        get editor() {
          return editor.current ?? undefined;
        },
      }),
    [pane.id],
  );
  if (initial === null) return <Loading label="Opening scratch plane…" />;
  const toolbar = (
    <div className="preview-toolbar text-editing-toolbar">
      {/* a scratch plane is saved as a file: there is nothing to save while it is empty. Save comes
          first, so the language choice keeps its place as it appears (2026-10-23) */}
      {!empty && (
        <button
          className="primary"
          title="Save As… (⌘S)"
          onClick={() => void saveAs().catch(report)}
        >
          Save…
        </button>
      )}
      <ChoiceButton
        label="Language"
        value={pane.language ?? 'plaintext'}
        choices={textLanguages.map((language) => ({
          value: language.id,
          label: language.label,
          aliases: language.extensions,
        }))}
        onChoose={(language) => {
          updatePane(pane.id, { language });
          current.current = { ...current.current, language };
          if (text.current || editor.current?.text()) keep(editor.current?.text() ?? text.current);
        }}
      />
    </div>
  );
  return (
    <div className="text-editing" data-scratch-plane={pane.id}>
      {header ? createPortal(toolbar, header) : toolbar}
      <Suspense fallback={<Loading label="Opening the editor…" />}>
        <TextEditor
          text={initial}
          language={pane.language}
          label={`Edit ${pane.title ?? 'Untitled'}`}
          settings={settings}
          onChange={changed}
          onFinal={final}
          onHandle={(handle) => {
            editor.current = handle;
            focusOnce();
          }}
        />
      </Suspense>
    </div>
  );
}
