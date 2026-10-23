import { useEffect, useState, type ReactNode } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { isPackage } from '../../domain/files';

const icons = new Map<string, string>();
let reported = false;
const limit = 600;
/** An application or another bundle, shown by its own icon as Finder shows it (2026-10-23). */
export const hasBundleIcon = (entry: Pick<FileEntry, 'directory' | 'extension'>) =>
  isPackage(entry);

/** An application's own icon, as Finder shows it; `fallback` shows while it loads or
 * when the bundle has none. Icons are cached for the session. */
export function AppIcon({
  entry,
  size,
  fallback,
}: {
  entry: Pick<FileEntry, 'path' | 'modified'>;
  size: number;
  fallback: ReactNode;
}) {
  const variant = size > 24 ? 'large' : 'small';
  const key = `${variant}\0${entry.modified}\0${entry.path}`;
  const [icon, setIcon] = useState(() => icons.get(key) ?? '');
  useEffect(() => {
    const cached = icons.get(key);
    if (cached !== undefined) {
      setIcon(cached);
      return;
    }
    let live = true;
    setIcon('');
    void window.viewer
      .appIcon(entry.path, variant)
      .then((value) => {
        icons.set(key, value);
        if (icons.size > limit) icons.delete(icons.keys().next().value!);
        if (live) setIcon(value);
      })
      .catch((error: unknown) => {
        // Without access or an icon, the folder icon stays; said once, not silently each time
        if (!reported) {
          reported = true;
          console.warn('Viewer could not show a bundle icon:', error);
        }
      });
    return () => {
      live = false;
    };
  }, [key, entry.path, variant]);
  return icon ? (
    <img className="app-icon" src={icon} alt="" width={size} height={size} draggable={false} />
  ) : (
    fallback
  );
}
