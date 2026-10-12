import type { FileEntry } from '../../domain/contracts';
import type { ApplicationSettings } from '../../domain/services';
import { choosePreview } from '../previews/registry';
/** Opening policy is shared by folder and search explorers; explicit linked-open always wins. */
export function nativeOpening(
  entry: FileEntry,
  policy: ApplicationSettings['fileOpening'],
  linked = false,
): boolean {
  if (entry.directory || linked) return false;
  const override = policy.types[entry.extension.toLowerCase()];
  if (override) return override === 'native';
  return (
    policy.default === 'native' ||
    (policy.default === 'automatic' && choosePreview(entry).id === 'fallback')
  );
}
