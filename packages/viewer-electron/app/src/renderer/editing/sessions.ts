/**
 * A plane that shows a new file because of Save As goes on editing it in the same editor session:
 * the file the session wrote is its own to overwrite, so its next save does not send the version it
 * just wrote to the Trash. Held from the Save As until the plane's next editor takes it.
 */
const continued = new Map<string, string>();
export function continueEditing(paneID: string, session: string): void {
  continued.set(paneID, session);
}
/** Whether a plane is to open its file for editing, continuing a session. */
export const continuesEditing = (paneID: string) => continued.has(paneID);
/** Whether `session` goes on in the plane's next editor, so it must not end with this one. */
export const sessionContinues = (paneID: string, session: string) =>
  continued.get(paneID) === session;
/** The session a plane's new editor continues, taken once. */
export function takeSession(paneID: string): string | undefined {
  const session = continued.get(paneID);
  continued.delete(paneID);
  return session;
}
