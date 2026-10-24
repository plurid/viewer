import type { UIPreferences } from '../../domain/contracts';

type Backdrop = UIPreferences['space']['backdrop'];

/**
 * A SEE-THROUGH SPACE (2026-10-23). The window options for the space's backdrop: macOS vibrancy blurs
 * what is behind the window; a clear backdrop needs a window created transparent. The renderer then
 * draws the space at the chosen opacity, the planes opaque over it.
 */
export function backdropWindowOptions(backdrop: Backdrop, look: 'dark' | 'light') {
  if (backdrop === 'clear')
    return {
      transparent: true,
      backgroundColor: '#00000000',
      // macOS can cache a transparent window's shadow from the opaque planes before app hide.
      // Plane shadows belong to the renderer; a native alpha-derived shadow can retain old shapes.
      hasShadow: false,
    };
  if (backdrop === 'blur')
    return {
      vibrancy: 'under-window' as const,
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    };
  return { backgroundColor: look === 'dark' ? '#272a30' : '#eef0f4' };
}

/** Whether a window made for `created` can show `next` now, or only once a new window opens. */
export const backdropChange = (created: Backdrop, next: Backdrop): 'live' | 'reopen' =>
  (created === 'clear') === (next === 'clear') ? 'live' : 'reopen';
