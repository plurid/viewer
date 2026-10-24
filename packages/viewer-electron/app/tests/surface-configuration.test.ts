import { describe, expect, it } from 'vitest';
import { TOOLBAR_DRAWERS } from '@plurid/plurid-data';
import { surfaceConfiguration } from '../src/renderer/workspace/surface-configuration';
import { normalizePreferences } from '../src/domain/preferences/ui';

describe('the plurid configuration of a workspace (2026-10-21)', () => {
  const configuration = (toolbar = true) =>
    surfaceConfiguration({
      look: 'dark',
      size: { width: 992, height: 692 },
      preferences: { ...normalizePreferences().space, toolbar },
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
});
