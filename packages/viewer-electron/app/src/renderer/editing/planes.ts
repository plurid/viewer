/** What an open text editor offers the window: its edits, and the commands that route to it. */
export interface EditorHandle {
  undo(): boolean;
  redo(): boolean;
  selectAll(): boolean;
  /** Opens Viewer's find over the text (⌘F), the selection as its query. */
  find(): void;
  focus(): void;
  hasFocus(): boolean;
  /** The whole text, with the file's own line breaks. */
  text(): string;
  /** Removes spaces and tabs at line ends, as one undoable edit (trimming on save). */
  trimTrailingWhitespace(): void;
}
/** A plane that edits text: a previewed file, or a scratch plane. */
export interface EditingPlane {
  /** Starts editing a previewed file; absent while it is already edited or cannot be. */
  edit?(): void;
  /** Saves, while editing; false when the person cancelled or the save was refused. */
  save?(): Promise<boolean>;
  /** Save As; `suggested` (`:w path`) is where the dialog opens, still asked. */
  saveAs?(suggested?: string): Promise<boolean>;
  /** Back to the saved text, after asking; absent while nothing is unsaved. */
  revert?(): Promise<void>;
  /** Leaves editing, asking first about unsaved edits. */
  done?(): Promise<void>;
  /** Whether it holds text not saved, including what was typed in the last moment. */
  dirty(): boolean;
  /** Its file changed on disk (another app saved it): shown again, or asked about when edited. */
  changedOnDisk?(): void;
  /** Drops its unsaved text, with any write still pending, after a person chose Don't Save. */
  discard?(): Promise<void>;
  editor?: EditorHandle;
}

const planes = new Map<string, EditingPlane>();
const listeners = new Set<() => void>();
/** Each plane's editing, registered while it is shown. */
export function registerEditingPlane(paneID: string, plane: EditingPlane): () => void {
  planes.set(paneID, plane);
  for (const listener of listeners) listener();
  return () => {
    if (planes.get(paneID) !== plane) return;
    planes.delete(paneID);
    for (const listener of listeners) listener();
  };
}
export const editingPlane = (paneID: string | undefined) =>
  paneID ? planes.get(paneID) : undefined;
/** The plane whose editor has the keyboard focus. */
export function focusedEditingPlane(): EditingPlane | undefined {
  for (const plane of planes.values()) if (plane.editor?.hasFocus()) return plane;
}
/** Commands re-evaluate when an editor opens or closes. */
export function subscribeEditingPlanes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Edit menu commands for the focused editor, or for the active plane's editor (`undo-file` and
 * `redo-file` only): the menu's Undo and Select All reached `webContents`, which a CodeMirror editor
 * does not answer, and with the focus elsewhere ⌘Z undid the save underneath an open editor.
 */
export function routeToEditor(command: string, activePane: string): boolean {
  const focused = focusedEditingPlane();
  const editor =
    focused?.editor ??
    (['undo-file', 'redo-file'].includes(command) ? editingPlane(activePane)?.editor : undefined);
  if (!editor) return false;
  if (command === 'undo-file') editor.undo();
  else if (command === 'redo-file') editor.redo();
  else if (command === 'select-all') editor.selectAll();
  // ⌘F in an editor finds in its text, rather than opening the file palette
  else if (command === 'find-file') editor.find();
  else return false;
  return true;
}
