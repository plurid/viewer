import { describe, expect, it } from 'vitest';
import { defaultSidebarLocations } from '../src/desktop/files/sidebar-locations';
import { sidebarLocationOrder } from '../src/domain/preferences/sidebar-locations';

describe('native sidebar defaults', () => {
  it('puts Home after Applications and before Volumes on macOS', () => {
    const locations = defaultSidebarLocations('darwin', '/Users/example');
    expect(locations.map((item) => item.name)).toEqual([
      'Desktop',
      'Documents',
      'Downloads',
      'Pictures',
      'Movies',
      'Music',
      'Applications',
      'Home',
      'Volumes',
      'Trash',
    ]);
    expect(
      sidebarLocationOrder(['/Users/example', '/Applications'], locations).slice(0, 2),
    ).toEqual(['/Users/example', '/Applications']);
  });

  it('uses relocated native folders and Windows paths', () => {
    const locations = defaultSidebarLocations(
      'win32',
      'C:\\Users\\example',
      (folder) => (folder === 'documents' ? 'D:\\Documents' : undefined),
      'D:\\Programs',
    );
    expect(locations.find((item) => item.name === 'Documents')?.path).toBe('D:\\Documents');
    expect(locations.find((item) => item.name === 'Videos')?.path).toBe(
      'C:\\Users\\example\\Videos',
    );
    expect(locations.slice(-4)).toEqual([
      { name: 'Applications', path: 'D:\\Programs' },
      { name: 'Home', path: 'C:\\Users\\example' },
      { name: 'Computer', path: 'C:\\' },
      expect.objectContaining({ name: 'Recycle Bin' }),
    ]);
  });

  it('uses Linux native folders and falls back when resolution is unavailable', () => {
    const locations = defaultSidebarLocations('linux', '/home/example', (folder) => {
      if (folder === 'videos') return '/media/Clips';
      throw new Error('Unavailable');
    });
    expect(locations.find((item) => item.name === 'Videos')?.path).toBe('/media/Clips');
    expect(locations[0]?.path).toBe('/home/example/Desktop');
    expect(locations.slice(-4).map((item) => item.name)).toEqual([
      'Applications',
      'Home',
      'Computer',
      'Trash',
    ]);
  });
});
