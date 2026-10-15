/** Whether a modal dialog is open; focus restoration and plane shortcuts wait for it. */
export const dialogOpen = () => !!document.querySelector('dialog[open]');
/** Whether a dialog or a context menu currently owns the keyboard. */
export const overlayOpen = () => !!document.querySelector('dialog[open], .context-menu');
