import { describe, expect, it } from 'vitest';
import { trashLocation } from '../src/domain/files/trash';
import { sidebarLocationOrder } from '../src/domain/preferences/sidebar-locations';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';
import { normalizePreferences, reorder } from '../src/domain/preferences/ui';

const locations = [
  { path: '/Users/example', name: 'Home' },
  { path: '/Users/example/Downloads', name: 'Downloads' },
  { path: '/Applications', name: 'Applications' },
  { path: '/Volumes', name: 'Volumes' },
  { path: trashLocation, name: 'Trash' },
];

describe('saved sidebar location order', () => {
  it('saves Home reordered among the actual bootstrap locations without serializing Trash', () => {
    const order = sidebarLocationOrder([], locations);
    const preferences = normalizePreferences();
    preferences.sidebar.locations = reorder(order, '/Users/example');

    expect(preferencesSchema.parse(preferences).sidebar.locations).toEqual([
      '/Users/example/Downloads',
      '/Applications',
      '/Volumes',
      '/Users/example',
    ]);
    expect(normalizePreferences(preferences).sidebar.locations).toEqual(
      preferences.sidebar.locations,
    );
  });

  it('preserves every physical location when moving before the pinned Trash destination', () => {
    const order = sidebarLocationOrder([], locations);
    const moved = reorder(order, '/Users/example', trashLocation);

    expect(moved).toHaveLength(locations.length - 1);
    expect(moved.at(-1)).toBe('/Users/example');
    expect(moved).not.toContain(trashLocation);
  });

  it('keeps preferred order and new locations while filtering legacy Trash and duplicates', () => {
    expect(
      sidebarLocationOrder(
        ['/Applications', trashLocation, '/Users/example', '/Applications'],
        locations,
      ),
    ).toEqual(['/Applications', '/Users/example', '/Users/example/Downloads', '/Volumes']);
  });

  it('keeps strict path validation for imported or unrelated location identifiers', () => {
    for (const invalid of [trashLocation, 'https://example.com', 'relative/folder']) {
      const preferences = normalizePreferences();
      preferences.sidebar.locations = [invalid];
      expect(preferencesSchema.safeParse(preferences).success).toBe(false);
    }
  });
});
