import { useEffect, useRef, type RefObject } from 'react';
import type { FileEntry } from '../../domain/contracts';

type Reveal = (path: string) => Promise<boolean>;
const views = new Map<string, Set<Reveal>>();
export const fileSelector = (path: string) => `[data-file-path="${CSS.escape(path)}"]`;

/** Reveal through the actual virtualizer before the engine measures the source in local plane pixels. */
export function useFileReveal(
  scroll: RefObject<HTMLDivElement | null>,
  entries: readonly FileEntry[],
  reveal: (index: number) => void,
) {
  const current = useRef(reveal);
  current.current = reveal;
  useEffect(() => {
    const element = scroll.current;
    const owner = element?.closest<HTMLElement>('[data-file-owner]')?.dataset.fileOwner;
    if (!element || !owner) return;
    const invoke: Reveal = async (path) => {
      const index = entries.findIndex((entry) => entry.path === path);
      if (index < 0) return false;
      current.current(index);
      const deadline = performance.now() + 1500;
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!element.isConnected) return false;
        if (element.querySelector(fileSelector(path))) return true;
      } while (performance.now() < deadline);
      return false;
    };
    const set = views.get(owner) || new Set<Reveal>();
    views.set(owner, set);
    set.add(invoke);
    return () => {
      set.delete(invoke);
      if (!set.size) views.delete(owner);
    };
  }, [scroll, entries]);
}
export async function revealFile(owner: string, path: string): Promise<string> {
  for (const reveal of views.get(owner) || []) if (await reveal(path)) return fileSelector(path);
  throw new Error('The originating file is no longer visible in this view.');
}
