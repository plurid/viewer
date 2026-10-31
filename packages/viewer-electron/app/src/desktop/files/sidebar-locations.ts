import path from 'node:path';
import { trashLocation, trashName, type DesktopPlatform } from '../../domain/files/trash';
import { applicationsPath } from '../operations/trash-locations';

type KnownFolder = 'desktop' | 'documents' | 'downloads' | 'pictures' | 'videos' | 'music';

/** Native folder paths may be relocated or localized; saved sidebar order remains independent. */
export function defaultSidebarLocations(
  platform: DesktopPlatform,
  home: string,
  resolve?: (folder: KnownFolder) => string | undefined,
  programFiles?: string,
): { name: string; path: string }[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const folders: readonly [KnownFolder, string][] = [
    ['desktop', 'Desktop'],
    ['documents', 'Documents'],
    ['downloads', 'Downloads'],
    ['pictures', 'Pictures'],
    ['videos', platform === 'darwin' ? 'Movies' : 'Videos'],
    ['music', 'Music'],
  ];
  return [
    ...folders.map(([key, name]) => {
      let native: string | undefined;
      try {
        native = resolve?.(key);
      } catch {
        // An unavailable native folder API keeps the platform's conventional destination.
      }
      return { name, path: native && paths.isAbsolute(native) ? native : paths.join(home, name) };
    }),
    { name: 'Applications', path: applicationsPath(platform, home, programFiles) },
    { name: 'Home', path: home },
    {
      name: platform === 'darwin' ? 'Volumes' : 'Computer',
      path: platform === 'darwin' ? '/Volumes' : paths.parse(home).root,
    },
    { name: trashName(platform), path: trashLocation },
  ];
}
