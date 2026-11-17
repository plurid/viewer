/** A dismissed notice must not leave keyboard input on the document body. */
export function focusCommandTerminal(id?: string): void {
  const pane = id ? [...document.querySelectorAll<HTMLElement>('[data-terminal-id]')]
    .find((element) => element.dataset.terminalId === id) : undefined;
  const target = pane?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? pane ??
    document.querySelector<HTMLElement>('.workspace-surface');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
