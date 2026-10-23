import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  sameTextVersion,
  textChangedCode,
  type TextDocument,
  type TextVersion,
} from '../../domain/text-documents';
import { languageFor } from '../../domain/text-languages';
import { baseName } from '../../domain/planes';
import { Empty, Loading } from '../ui/primitives';
import { FolderAccessButton } from '../ui/FolderAccessButton';
import { report, updatePane, useViewer } from '../state/store';
import { discardBuffer, keepBuffer, readBuffer } from './buffers';
import { registerEditingPlane, type EditorHandle } from './planes';
import { continueEditing, sessionContinues, takeSession } from './sessions';

const TextEditor = lazy(() => import('../previews/editor/TextEditor'));

/**
 * EDITING A PREVIEWED FILE (2026-10-23). The file opens for editing where it is, when the desktop
 * says it can be. Unsaved edits are kept in the profile as they are typed and come back with the
 * plane. Each save is checked against the version that was read, and a file changed on disk since
 * is never overwritten without asking.
 */
export function FileEditor({
  resourceID,
  paneID,
  bufferID,
  header,
  focus = false,
  onClose,
}: {
  resourceID: string;
  paneID: string;
  /** Unsaved edits the plane holds, to restore. */
  bufferID?: string;
  header?: HTMLElement;
  /** Asked for (Edit, Save As): takes the keys. Edits restored at launch leave the focus alone. */
  focus?: boolean;
  onClose(): void;
}) {
  const [loaded, setLoaded] = useState<{
    document: TextDocument;
    text: string;
    generation: number;
  } | null>(null);
  const [refusal, setRefusal] = useState<{ reason: string; folder?: string } | null>(null);
  const [conflict, setConflict] = useState<'changed' | 'restored' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyNow = useRef(false);
  const focused = useRef(false);
  const base = useRef<TextVersion | undefined>(undefined);
  const saved = useRef('');
  const buffer = useRef(bufferID);
  const editor = useRef<EditorHandle | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const session = useMemo(() => takeSession(paneID) ?? crypto.randomUUID(), [paneID]);
  const settings = useViewer((state) => state.settings.settings.editor);
  const document = loaded?.document;
  const name = document ? baseName(document.file) : 'this file';
  const language = document
    ? languageFor({ name, extension: name.split('.').pop() ?? '' })
    : undefined;
  const mark = (value: boolean) => {
    dirtyNow.current = value;
    setDirty(value);
  };
  const forget = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const id = buffer.current;
    if (!id) return;
    buffer.current = undefined;
    updatePane(paneID, { bufferID: undefined });
    await discardBuffer(id);
  }, [paneID]);
  const open = useCallback(
    async (restore: boolean) => {
      const opening = await window.viewer.textOpen(resourceID);
      if (!opening.editable) {
        setRefusal({ reason: opening.reason, folder: opening.folder });
        return;
      }
      setRefusal(null);
      const { document } = opening;
      base.current = document.version;
      saved.current = document.text;
      let text = document.text;
      let restored = false;
      const kept = restore && buffer.current ? await readBuffer(buffer.current) : null;
      if (kept?.kind === 'file' && kept.file === document.file) {
        text = kept.text;
        restored = !kept.base || !sameTextVersion(kept.base, document.version);
      }
      mark(text !== document.text);
      setConflict(restored ? 'restored' : null);
      setLoaded((previous) => ({ document, text, generation: (previous?.generation ?? 0) + 1 }));
    },
    [resourceID],
  );
  useEffect(() => {
    // a resource gone since the preview opened says so, rather than loading forever
    void open(true).catch((error: unknown) =>
      setRefusal({ reason: error instanceof Error ? error.message : String(error) }),
    );
  }, [open]);
  useEffect(
    () => () => {
      if (!sessionContinues(paneID, session)) void window.viewer.textEditEnd(session).catch(report);
    },
    [paneID, session],
  );
  /** Keeps what is typed, or forgets the buffer once the text is back to what is saved. */
  const keep = (text: string) => {
    if (!document) return;
    if (text === saved.current) {
      mark(false);
      void forget().catch(report);
      return;
    }
    if (!buffer.current) {
      buffer.current = crypto.randomUUID();
      updatePane(paneID, { bufferID: buffer.current });
    }
    keepBuffer({
      id: buffer.current,
      kind: 'file',
      file: document.file,
      base: base.current,
      bom: document.bom,
      language: language?.id,
      title: name,
      text,
    });
    mark(true);
  };
  const changed = () => {
    mark(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      keep(editor.current?.text() ?? '');
    }, 250);
  };
  /** The editor's last text as it closes: kept, so nothing typed in its last moment is lost. */
  const final = (text: string) => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    keep(text);
  };
  const save = async (): Promise<boolean> => {
    if (!document || !base.current || saving) return false;
    // nothing unsaved: a save would only send an identical copy to the Trash
    if (!dirtyNow.current) return true;
    // as VS Code trims on save: an undoable edit, so the editor shows what the file holds
    if (settings.trimTrailingWhitespace) editor.current?.trimTrailingWhitespace();
    clearTimeout(timer.current);
    timer.current = undefined;
    const text = editor.current?.text() ?? loaded?.text ?? '';
    setSaving(true);
    try {
      base.current = await window.viewer.textSave(
        document.file,
        text,
        base.current,
        session,
        document.bom,
      );
      saved.current = text;
      setConflict(null);
      await forget();
      // text typed while the save was written stays unsaved
      const now = editor.current?.text() ?? text;
      if (now !== text) keep(now);
      else mark(false);
      return true;
    } catch (error) {
      // what was typed up to the save stays kept, refused or not
      keep(editor.current?.text() ?? text);
      if ((error as { code?: string }).code === textChangedCode) setConflict('changed');
      else report(error);
      return false;
    } finally {
      setSaving(false);
    }
  };
  /** After a refusal: the version on disk now goes to the Trash, and these edits take its place. */
  const saveOver = async () => {
    const opening = await window.viewer.textOpen(resourceID);
    if (!opening.editable) {
      setRefusal({ reason: opening.reason, folder: opening.folder });
      return;
    }
    base.current = opening.document.version;
    await save();
  };
  const reload = async () => {
    await forget();
    await open(false);
  };
  const saveAs = async (): Promise<boolean> => {
    if (!loaded) return false;
    const text = editor.current?.text() ?? loaded.text;
    const result = await window.viewer.textSaveAs(text, name, session);
    if (!result) return false;
    await forget();
    // the plane shows the new file, still edited in this session
    continueEditing(paneID, session);
    updatePane(paneID, { path: result.file });
    return true;
  };
  /** Saved in another app: shown again when nothing is unsaved, as other editors do; with unsaved
   * edits, the bar asks. Its own save, seen by its version, changes nothing. */
  const changedOnDisk = async () => {
    const opening = await window.viewer.textOpen(resourceID);
    if (!opening.editable || !base.current) return;
    if (sameTextVersion(opening.document.version, base.current)) return;
    if (dirtyNow.current) {
      setConflict('changed');
      return;
    }
    base.current = opening.document.version;
    saved.current = opening.document.text;
    setLoaded((previous) => ({
      document: opening.document,
      text: opening.document.text,
      generation: (previous?.generation ?? 0) + 1,
    }));
  };
  const revert = async () => {
    if ((await window.viewer.textPrompt('revert', name)) === 'discard') await reload();
  };
  const done = async () => {
    if (dirtyNow.current) {
      const answer = await window.viewer.textPrompt('close', name);
      if (answer === 'cancel') return;
      if (answer === 'save' && !(await save())) return;
      if (answer === 'discard') await forget();
    }
    onClose();
  };
  const actions = useRef({ save, saveAs, revert, done, forget, changedOnDisk });
  actions.current = { save, saveAs, revert, done, forget, changedOnDisk };
  useEffect(
    () =>
      registerEditingPlane(paneID, {
        save: () => actions.current.save(),
        saveAs: () => actions.current.saveAs(),
        get revert() {
          return dirtyNow.current ? () => actions.current.revert() : undefined;
        },
        done: () => actions.current.done(),
        changedOnDisk: () => void actions.current.changedOnDisk().catch(report),
        dirty: () => dirtyNow.current,
        discard: async () => {
          mark(false);
          await actions.current.forget();
        },
        get editor() {
          return editor.current ?? undefined;
        },
      }),
    [paneID],
  );
  if (refusal)
    return (
      <Empty icon="warning" title="This file is not edited here" detail={refusal.reason}>
        {refusal.folder && (
          <FolderAccessButton folder={refusal.folder} onGranted={() => void open(true)} />
        )}
        {buffer.current && (
          <button onClick={() => void saveAs().catch(report)}>Save Unsaved Edits As…</button>
        )}
        <button onClick={onClose}>Back to Preview</button>
      </Empty>
    );
  if (!loaded) return <Loading label="Opening for editing…" />;
  const toolbar = (
    // Save only while something is unsaved; Save As and Revert are in the plane's ⋯ menu, and
    // ⇧⌘S and ⌘Z, rather than buttons (2026-10-23)
    <div className="preview-toolbar text-editing-toolbar">
      {dirty && (
        <button className="primary" disabled={saving} title="Save (⌘S)" onClick={() => void save()}>
          Save
        </button>
      )}
      <button title="Done editing" onClick={() => void done().catch(report)}>
        Done
      </button>
    </div>
  );
  return (
    <div className="text-editing">
      {header ? createPortal(toolbar, header) : toolbar}
      {conflict === 'changed' && (
        <p className="inline-warning editing-bar" role="alert">
          {name} changed on disk since it was opened.
          <button onClick={() => void reload().catch(report)}>Reload</button>
          <button onClick={() => void saveOver().catch(report)}>Save Over It</button>
          <button onClick={() => setConflict(null)}>Cancel</button>
        </p>
      )}
      {conflict === 'restored' && (
        <p className="inline-warning editing-bar" role="alert">
          {name} changed on disk after these unsaved edits were made. Saving them moves the version
          on disk to the Trash.
          <button
            onClick={() => {
              setConflict(null);
              // kept again over the version on disk now, so a relaunch does not ask again
              keep(editor.current?.text() ?? loaded.text);
            }}
          >
            Keep My Edits
          </button>
          <button onClick={() => void reload().catch(report)}>Use the File on Disk</button>
        </p>
      )}
      <Suspense fallback={<Loading label="Opening the editor…" />}>
        <TextEditor
          key={loaded.generation}
          text={loaded.text}
          language={language?.id}
          label={`Edit ${name}`}
          settings={settings}
          onChange={changed}
          onFinal={final}
          onHandle={(handle) => {
            editor.current = handle;
            // once: a version reloaded from disk does not take the focus from another plane
            if (focus && handle && !focused.current) {
              focused.current = true;
              handle.focus();
            }
          }}
        />
      </Suspense>
    </div>
  );
}
