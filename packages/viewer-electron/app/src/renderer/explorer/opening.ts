import type { FileEntry } from '../../domain/contracts';
import type { ApplicationSettings } from '../../domain/services';
import { isPackage } from '../../domain/files';
import { choosePreview } from '../previews/registry';
/** Opening policy is shared by folder and search explorers; explicit linked-open always wins. */
export function nativeOpening(
  entry: FileEntry,
  policy: ApplicationSettings['fileOpening'],
  linked = false,
): boolean {
  if (linked || (entry.directory && !isPackage(entry))) return false;
  const override = policy.types[entry.extension.toLowerCase()];
  if (override) return override === 'native';
  // an application starts, a bundle opens in its app, as Finder's double-click does
  if (isPackage(entry)) return true;
  return (
    policy.default === 'native' ||
    (policy.default === 'automatic' && choosePreview(entry).id === 'fallback')
  );
}
