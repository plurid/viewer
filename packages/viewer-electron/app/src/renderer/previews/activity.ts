import { createContext } from 'react';

/** Plurid's frozen tier still paints on screen; only its measurements stop.
 * Hidden/detached content pauses, while a zoomed-out visible tile stays live. */
export function planeIsActive(plane: {
  shown: boolean;
  culled: 'visible' | 'frozen' | 'hidden' | 'detached';
}): boolean {
  return plane.shown && (plane.culled === 'visible' || plane.culled === 'frozen');
}

/** Whether the plane holding a folder's embedded previews (Gallery, Columns) is on screen and
 * taking input, as a preview plane's own are told: passed neither, their media and animation ran
 * offscreen. */
export const PreviewActivity = createContext({ active: true, interactive: true });
