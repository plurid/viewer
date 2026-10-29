import { effectiveWindowSettings } from '../state/effective-ui';
import type { Pane } from '../../domain/contracts';
import { textChangedCode, trimTrailingWhitespace } from '../../domain/editing/documents';
import { languageByID } from '../../domain/editing/languages';
import { baseName } from '../../domain/workspaces/planes';
import {
  activeWorkspace,
  addPane,
  addScratchPane,
  announce,
  getState,
  report,
  updatePane,
} from '../state/store';
import { discardBuffer, readBuffer } from './buffers';
import { editingPlane } from './planes';
import { flushNote, flushNotes } from '../notes/sessions';

/** The name a plane's unsaved text is asked about under. */
const unsavedName = (pane: Pane) =>
  pane.type === 'scratch' ? (pane.title ?? 'Untitled') : baseName(pane.path);
/** A scratch plane's file name for Save As: its title, and the configured extension when it is one
 * of the plane's language, its language's own otherwise. */
export function scratchFileName(
  title: string,
  language: string | undefined,
  preferred = effectiveWindowSettings(getState()).browsing.newFileExtension,
): string {
  const extensions = (languageByID(language) ?? languageByID('plaintext'))?.extensions ?? ['txt'];
  return `${title}.${extensions.includes(preferred.toLowerCase()) ? preferred : extensions[0]}`;
}

async function unsaved(pane: Pane): Promise<boolean> {
  const plane = editingPlane(pane.id);
  if (plane?.save) return plane.dirty();
  if (pane.type === 'preview' || pane.type === 'diff')
    return !!pane.bufferID && !!(await readBuffer(pane.bufferID));
  if (pane.type !== 'scratch') return false;
  const buffer = await readBuffer(pane.bufferID);
  if (buffer?.text) return true;
  // nothing to lose: an empty scratch plane takes its empty buffer with it
  if (buffer) await discardBuffer(pane.bufferID);
  return false;
}
/** Saves a plane's unsaved text, through its editor when it is open. */
async function save(pane: Pane): Promise<boolean> {
  const plane = editingPlane(pane.id);
  if (plane?.save) return plane.save();
  // a save from the close prompt trims as the editor's own does
  const prepared = (text: string) =>
    effectiveWindowSettings(getState()).editor.trimTrailingWhitespace
      ? trimTrailingWhitespace(text)
      : text;
  if (pane.type === 'scratch') {
    const buffer = await readBuffer(pane.bufferID);
    if (!buffer) return true;
    const saved = await window.viewer.textSaveAs(
      prepared(buffer.text),
      scratchFileName(pane.title ?? 'Untitled', buffer.language ?? pane.language),
      crypto.randomUUID(),
    );
    if (!saved) return false;
    await discardBuffer(pane.bufferID);
    return true;
  }
  if ((pane.type !== 'preview' && pane.type !== 'diff') || !pane.bufferID) return true;
  const buffer = await readBuffer(pane.bufferID);
  if (!buffer) return true;
  if (!buffer.file || !buffer.base) {
    announce(`Open ${baseName(pane.path)} to review its unsaved edits before saving them.`);
    return false;
  }
  try {
    await window.viewer.textSave(
      buffer.file,
      prepared(buffer.text),
      buffer.base,
      crypto.randomUUID(),
      buffer.bom ?? false,
    );
  } catch (error) {
    if ((error as { code?: string }).code === textChangedCode)
      announce(
        `${baseName(pane.path)} changed on disk since it was edited. Open it to review the edits.`,
      );
    else report(error);
    return false;
  }
  await discardBuffer(pane.bufferID);
  updatePane(pane.id, { bufferID: undefined });
  return true;
}
async function discard(pane: Pane): Promise<void> {
  const plane = editingPlane(pane.id);
  if (plane?.discard) return plane.discard();
  if (pane.type === 'scratch') await discardBuffer(pane.bufferID);
  else if ((pane.type === 'preview' || pane.type === 'diff') && pane.bufferID) {
    await discardBuffer(pane.bufferID);
    updatePane(pane.id, { bufferID: undefined });
  }
}

/**
 * Before planes close: each holding unsaved text asks Save, Don't Save or Cancel, natively. False
 * when the person cancelled or a save did not happen, and nothing closes. Planes closed another
 * way (an arrangement Undo, a project reload) keep their text in the profile, recovered at launch.
 */
export async function confirmClose(ids: readonly string[]): Promise<boolean> {
  for (const pane of activeWorkspace().panes.filter((item) => ids.includes(item.id))) {
    if (pane.type === 'note') {
      await flushNote(pane.id);
      continue;
    }
    if (!(await unsaved(pane))) continue;
    const answer = await window.viewer.textPrompt('close', unsavedName(pane));
    if (answer === 'cancel') return false;
    if (answer === 'save') {
      if (!(await save(pane))) return false;
    } else await discard(pane);
  }
  return true;
}

/** Planes' unsaved text dropped without asking, as vim's `:q!`. Files are not touched:
 * only text typed and never saved is lost. */
export async function discardUnsaved(ids: readonly string[]): Promise<void> {
  for (const pane of activeWorkspace().panes.filter((item) => ids.includes(item.id))) {
    if (pane.type === 'note') {
      await flushNote(pane.id);
      continue;
    }
    if (await unsaved(pane)) await discard(pane);
  }
}
/** A plane's unsaved text saved, when it holds any (`:x`); true when nothing is left unsaved. */
export async function saveUnsaved(id: string): Promise<boolean> {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (pane?.type === 'note') {
    await flushNote(pane.id);
    return true;
  }
  if (!pane || !(await unsaved(pane))) return true;
  return save(pane);
}
/**
 * Every edited file in the workspace saved, as vim's `:wa`. A scratch plane has no
 * file yet: it is counted, not asked about, as vim leaves a buffer without a name.
 */
export async function saveAll(): Promise<{ saved: number; failed: number; unnamed: number }> {
  await flushNotes();
  const result = { saved: 0, failed: 0, unnamed: 0 };
  for (const pane of activeWorkspace().panes) {
    if (!(await unsaved(pane))) continue;
    if (pane.type === 'scratch') result.unnamed++;
    else if (await save(pane)) result.saved++;
    else result.failed++;
  }
  return result;
}

/**
 * At launch, unsaved text no plane holds comes back as planes: a scratch plane's, or a file's edits
 * beside it. A buffer is never dropped because nothing refers to it: a reset, a downgrade or a
 * closed plane forgotten can all leave one. Empty scratch text has nothing to keep.
 */
export async function recoverBuffers(): Promise<number> {
  const { buffers, problems } = await window.viewer.bufferList();
  for (const problem of problems) report(new Error(problem));
  const held = new Set(
    getState().saved.workspaces.flatMap((space) =>
      space.panes.flatMap((pane) =>
        pane.type === 'scratch' ||
        ((pane.type === 'preview' || pane.type === 'diff') && pane.bufferID)
          ? [pane.bufferID!]
          : [],
      ),
    ),
  );
  let recovered = 0;
  for (const buffer of buffers) {
    if (held.has(buffer.id)) continue;
    if (buffer.kind === 'scratch' && !buffer.bytes) {
      await discardBuffer(buffer.id);
      continue;
    }
    try {
      if (buffer.kind === 'scratch')
        addScratchPane({ bufferID: buffer.id, title: buffer.title, language: buffer.language });
      else if (buffer.file)
        updatePane(addPane(buffer.file, 'preview', true).id, { bufferID: buffer.id });
      else continue;
      recovered++;
    } catch (error) {
      // a full workspace: the rest stay kept, for the next launch
      report(error);
      break;
    }
  }
  if (recovered)
    announce(
      `Recovered unsaved text in ${recovered} ${recovered === 1 ? 'plane' : 'planes'}. Save or discard it from each plane.`,
    );
  return recovered;
}
