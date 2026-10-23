/** Each shown terminal plane's Find, so ⌘F in a terminal opens its search, not the file palette. */
const finders = new Map<string, () => void>();
export function registerTerminalFind(paneID: string, open: () => void): () => void {
  finders.set(paneID, open);
  return () => {
    if (finders.get(paneID) === open) finders.delete(paneID);
  };
}
/** Opens a terminal plane's search; false when that plane shows no terminal. */
export function openTerminalFind(paneID: string): boolean {
  const open = finders.get(paneID);
  open?.();
  return !!open;
}
