export interface ChatSelection {
  messageID: string;
  start: number;
  end: number;
}

/** Both endpoints must be within one message's text, excluding controls and attribution. */
export function chatSelection(
  root: HTMLElement,
  selection: Selection | null,
): ChatSelection | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  const element = (node: Node) =>
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const start = element(range.startContainer)?.closest<HTMLElement>('[data-chat-text]');
  const end = element(range.endContainer)?.closest<HTMLElement>('[data-chat-text]');
  if (!start || start !== end || !root.contains(start) || !start.dataset.chatText) return;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(start);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().length;
  const length = range.toString().length;
  if (!length || length > 16000) return;
  return { messageID: start.dataset.chatText, start: offset, end: offset + length };
}
