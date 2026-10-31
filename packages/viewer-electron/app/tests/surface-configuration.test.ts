import { describe, expect, it } from 'vitest';
import { TOOLBAR_DRAWERS } from '@plurid/plurid-data';
import {
  minimapPlanes,
  minimapShown,
  surfaceConfiguration,
} from '../src/renderer/workspace/surface-configuration';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';
import { normalizePreferences } from '../src/domain/preferences/ui';

describe('the plurid configuration of a workspace (2026-10-21)', () => {
  const configuration = (toolbar = true) =>
    surfaceConfiguration({
      look: 'dark',
      size: { width: 992, height: 692 },
      preferences: { ...normalizePreferences().space, toolbar },
      minimap: true,
    });
  it('leaves out plurid’s Global drawer: Appearance in Settings is the one look control', () => {
    // Its theme, language and look pickers changed only plurid's own chrome, until Viewer's next
    // configuration change put its look back, and were never saved.
    const drawers = configuration().elements?.toolbar?.drawers ?? [];
    expect(drawers).not.toContain('GLOBAL');
    expect(drawers).not.toContain('ALL');
    expect([...drawers].sort()).toEqual(
      Object.keys(TOOLBAR_DRAWERS)
        .filter((drawer) => drawer !== 'ALL' && drawer !== 'GLOBAL')
        .sort(),
    );
  });
  it('keeps the toolbar preference and the plane size it was built for', () => {
    expect(configuration(false).elements?.toolbar?.show).toBe(false);
    expect(configuration().elements?.plane?.width).toBe(992 - 64);
  });
  it('hides spatial bridges while tiled and restores them in free space', () => {
    const tiled = surfaceConfiguration({
      look: 'dark',
      size: { width: 1440, height: 940 },
      preferences: normalizePreferences().space,
      minimap: true,
      tiled: true,
    });
    expect(tiled.elements?.planeBridge?.show).toBe(false);
    expect(tiled.elements?.planeLinks?.show).toBe(false);
    expect(configuration().elements?.planeBridge?.show).toBe(true);
    expect(configuration().elements?.planeLinks?.show).toBe(true);
  });
});

describe('a first run', () => {
  it('starts quiet: no space toolbar or viewcube, the grid on, the minimap automatic', () => {
    const space = normalizePreferences().space;
    expect(space).toMatchObject({
      toolbar: false,
      viewcube: false,
      grid: true,
      minimap: true,
      minimapAuto: true,
    });
    expect(minimapShown(space, minimapPlanes - 1)).toBe(false);
    expect(minimapShown(space, minimapPlanes)).toBe(true);
    expect(minimapShown({ ...space, minimap: false }, 12)).toBe(false);
  });
  it('leaves an existing profile’s spatial aids as they were, its minimap always shown', () => {
    const earlier = normalizePreferences({ version: 3, space: { toolbar: true, viewcube: true } });
    expect(earlier.space).toMatchObject({ toolbar: true, viewcube: true, minimapAuto: false });
    expect(minimapShown(earlier.space, 1)).toBe(true);
    // a configuration written before the setting keeps the minimap always
    const { minimapAuto: _automatic, ...space } = earlier.space;
    expect(preferencesSchema.parse({ ...earlier, space }).space.minimapAuto).toBe(false);
  });
});
