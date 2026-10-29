import { useEffect, useSyncExternalStore } from 'react';
import { hintLabels, visiblePlanes, type VisiblePlane } from './planes';

interface Hints {
  planes: (VisiblePlane & { label: string; centre: { x: number; y: number } })[];
  typed: string;
  choose(paneID: string): void;
}
let hints: Hints | null = null;
const listeners = new Set<() => void>();
const publish = (next: Hints | null) => {
  hints = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/**
 * Plane hints: a label on every plane in view, as Vimium labels links; typing one
 * chooses that plane. Escape, or a key no label starts with, ends them.
 */
export function startPlaneHints(choose: (paneID: string) => void): boolean {
  const planes = visiblePlanes();
  if (!planes.length) return false;
  const labels = hintLabels(planes.length);
  const bounds = document.querySelector('.workspace-surface')?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    right: innerWidth,
    bottom: innerHeight,
  };
  const centre = ({ rect }: VisiblePlane) => {
    const left = Math.max(rect.left, bounds.left);
    const right = Math.min(rect.right, bounds.right);
    const top = Math.max(rect.top, bounds.top);
    const bottom = Math.min(rect.bottom, bounds.bottom);
    // a plane mostly off screen: its label stays whole, just inside the space
    const clamp = (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low + 24), high - 24);
    return {
      x: clamp((left + right) / 2, bounds.left, bounds.right),
      y: clamp((top + bottom) / 2, bounds.top, bounds.bottom),
    };
  };
  publish({
    planes: planes.map((plane, index) => ({
      ...plane,
      label: labels[index]!,
      centre: centre(plane),
    })),
    typed: '',
    choose,
  });
  return true;
}
export function PlaneHints() {
  const current = useSyncExternalStore(subscribe, () => hints);
  useEffect(() => {
    if (!current) return;
    const keydown = (event: KeyboardEvent) => {
      if (!hints || event.isComposing) return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const key = event.key.toLowerCase();
      if (event.key === 'Escape' || key.length !== 1 || event.metaKey || event.ctrlKey) {
        publish(null);
        return;
      }
      const typed = hints.typed + key;
      const matching = hints.planes.filter((plane) => plane.label.startsWith(typed));
      if (!matching.length) publish(null);
      else if (matching.length === 1 && matching[0]!.label === typed) {
        const { choose } = hints;
        publish(null);
        choose(matching[0]!.paneID);
      } else publish({ ...hints, typed });
    };
    // the space moving under the labels ends them: they would point at the wrong planes
    const cancel = () => publish(null);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('wheel', cancel, { capture: true, passive: true });
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('resize', cancel);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('wheel', cancel, true);
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('resize', cancel);
    };
  }, [current]);
  if (!current) return null;
  return (
    <div className="plane-hints" aria-label="Plane hints" role="status">
      {current.planes
        .filter((plane) => plane.label.startsWith(current.typed))
        .map((plane) => (
          <span
            key={plane.paneID}
            className="plane-hint"
            data-pane={plane.paneID}
            // at the middle of what shows of the plane: a plane half off screen is labelled where it is seen
            style={{ left: plane.centre.x, top: plane.centre.y }}
          >
            <b>{plane.label.slice(0, current.typed.length)}</b>
            {plane.label.slice(current.typed.length)}
          </span>
        ))}
    </div>
  );
}
