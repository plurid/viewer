import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PreviewCommand, PreviewContext } from './contracts';
const slots = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
export function setPreviewControlsSlot(id: string, element: HTMLElement | null): void {
  if (element) slots.set(id, element);
  else slots.delete(id);
  for (const listener of listeners) listener();
}
export function usePreviewControlsSlot(id?: string): HTMLElement | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (id ? slots.get(id) : undefined),
  );
}
export function PreviewToolbar({
  context,
  children,
}: {
  context: PreviewContext;
  children: ReactNode;
}) {
  const content = <div className="preview-toolbar">{children}</div>;
  return context.commands?.header ? createPortal(content, context.commands.header) : content;
}
export function usePreviewCommands(
  context: PreviewContext,
  commands: readonly PreviewCommand[],
): void {
  useEffect(() => context.commands?.register(commands), [context.commands, commands]);
}
