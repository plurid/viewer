import type { WorkspaceController } from './context';

let touring: { stop(): void } | null = null;
export const tourActive = () => !!touring;
export function stopTour(): void {
  touring?.stop();
}
/**
 * TOUR: the space's saved views in turn, each flown to and shown for a while, as a
 * presentation. Any key, click or scroll stops it; so does the last view, unless it loops.
 */
export function startTour(
  workspace: WorkspaceController,
  { dwell, duration, loop }: { dwell: number; duration: number; loop: boolean },
): void {
  stopTour();
  const names = workspace.bookmarks().map((view) => view.name);
  if (!names.length) throw new Error('Save a view first: ⌃⌥⌘1–9, or Save view… in the palette.');
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener('keydown', stop, true);
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('wheel', stop, true);
    touring = null;
  };
  const next = () => {
    if (stopped) return;
    if (index >= names.length) {
      if (!loop) return stop();
      index = 0;
    }
    const name = names[index++]!;
    const flown = workspace.goBookmark(name, {
      duration,
      onSettle: () => {
        timer = setTimeout(next, dwell);
      },
    });
    // a view removed meanwhile: on to the next
    if (!flown) timer = setTimeout(next, 0);
  };
  touring = { stop };
  // after the key that started it, so that key does not end it
  setTimeout(() => {
    if (stopped) return;
    window.addEventListener('keydown', stop, true);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('wheel', stop, { capture: true, passive: true });
  }, 0);
  next();
}
