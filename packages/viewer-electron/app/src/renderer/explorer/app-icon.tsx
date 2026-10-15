import { useEffect, useState, type ReactNode } from 'react';
import type { FileEntry } from '../../domain/contracts';

const icons = new Map<string, string>();
const limit = 600;
export const isApplication = (entry: Pick<FileEntry, 'directory' | 'extension'>) =>
  entry.directory && entry.extension === 'app';

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
      .catch(() => {
        // Without access or an icon, the folder icon stays.
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
