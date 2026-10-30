import type { FileEntry } from '../../domain/contracts';
import type { FileIdentity } from '../../domain/files/signatures';
import type { ApplicationSettings } from '../../domain/services';
import { isPackage } from '../../domain/files/entries';
import { embeddedFormat } from '../../domain/previews/documents/embedded';
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
  // Viewer shows only the picture such a document saved: its app opens it, Space previews it
  if (embeddedFormat(entry.extension)) return true;
  return (
    policy.default === 'native' ||
    (policy.default === 'automatic' && choosePreview(entry).id === 'fallback')
  );
}

/** Extensions two kinds of file share, and whether these first bytes are the kind its app opens:
 * a Keynote document is a ZIP, a key or certificate named `.key` is text. */
const sharedExtensions: Record<string, (identity: FileIdentity | null) => boolean> = {
  key: (identity) => identity?.extension === 'zip',
};

/** Runs `native` or `viewer` for a double-click: at once, or for a shared extension after reading
 * the file's first bytes. A file whose bytes cannot be read goes to its app, as before. */
export function chooseOpening(
  entry: FileEntry,
  policy: ApplicationSettings['fileOpening'],
  linked: boolean,
  native: () => void,
  viewer: () => void,
): void {
  if (!nativeOpening(entry, policy, linked)) return viewer();
  const extension = entry.extension.toLowerCase();
  const shared = sharedExtensions[extension];
  if (!shared || entry.directory || policy.types[extension]) return native();
  void window.viewer.fileIdentity(entry.path).then(
    (identity) => (shared(identity) ? native() : viewer()),
    () => native(),
  );
}
