import { TOOLBAR_DRAWERS, type PluridPartialConfiguration } from '@plurid/plurid-data';
import type { UIPreferences } from '../../domain/contracts';
import { looks } from './look';

/** plurid's toolbar drawers Viewer offers: all but Global. Viewer sets the look from its Appearance
 * setting, so the Global drawer's look, theme and language picks changed only plurid's chrome, until
 * Viewer's next configuration put its look back, and were never saved (2026-10-21). */
const drawers = (Object.keys(TOOLBAR_DRAWERS) as (keyof typeof TOOLBAR_DRAWERS)[]).filter(
  (drawer) => drawer !== 'ALL' && drawer !== 'GLOBAL',
);

/** The engine configuration of a workspace surface. */
export function surfaceConfiguration({
  look,
  size,
  preferences,
}: {
  look: keyof typeof looks;
  size: { width: number; height: number };
  preferences: UIPreferences['space'];
}): PluridPartialConfiguration {
  return {
    global: { look: looks[look] },
    space: {
      dimensions: { width: '100%', height: '100%' },
      presentation: 'space',
      transformOrigin: { show: preferences.origin },
      // Workspace persistence owns navigation; a shared window URL must not
      // restore a plane belonging to another workspace.
      docking: { url: false },
      clipboard: false,
      gestures: { wheel: 'click-to-scroll', dragHandle: 'chrome' },
      bridge: { preset: 'reading', planeAngle: 90.1 },
      shortcuts: {
        // The engine's own close/reopen keys change its tree without Viewer's workspace,
        // which then keeps (and later restores) the closed plane. Viewer's Close plane
        // (⌥⌘W) and Undo arrangement keep both in step.
        disabled: [
          'palette',
          'copy',
          'cut',
          'paste',
          'undo',
          'redo',
          'duplicateSelection',
          'closePlane',
          'openClosedPlane',
        ],
      },
      culling: {
        enabled: true,
        distance: 6000,
        freezeDistance: 3500,
        detach: { mode: 'unmount', delay: 1500, max: 40 },
      },
      navigation: { onClose: 'parent', framing: { fill: 0.92 }, childFraming: 'plane' },
    },
    elements: {
      minimap: { show: preferences.minimap },
      viewcube: { show: preferences.viewcube },
      toolbar: { show: preferences.toolbar, drawers },
      shortcuts: { show: false },
      palette: { show: false },
      // Viewer owns frame/dock commands in the workspace header. The engine's
      // floating duplicate controls would cover preview actions when docked.
      dockRail: { show: false },
      // Automatic dimensions use the engine's live configuration; changing the
      // registered routes would reconstruct its store and discard linked planes.
      plane: {
        width: Math.max(380, size.width - 64),
        height: Math.max(300, size.height - 112),
        controls: { show: preferences.planeHeaders },
        resizable: preferences.resizing,
        backface: 'visible',
      },
    },
  };
}
