import { trashLocation } from '../files/trash';
import { reorder } from './ui';

interface SidebarLocations {
  locations: readonly string[];
  hidden: readonly string[];
}

/** Trash is a pinned destination, not a filesystem shortcut in the saved order. */
export function sidebarLocationOrder(
  preferred: readonly string[],
  locations: readonly { path: string }[],
): string[] {
  return [...new Set([...preferred, ...locations.map((location) => location.path)])].filter(
    (path) => path !== trashLocation,
  );
}

/** Only displayed filesystem locations participate in a person's visible move. */
export function displayedSidebarLocations(
  preferences: SidebarLocations,
  locations: readonly { path: string }[],
): string[] {
  const available = new Set(locations.map((location) => location.path));
  const hidden = new Set(preferences.hidden);
  return sidebarLocationOrder(preferences.locations, locations).filter(
    (path) => available.has(path) && !hidden.has(path),
  );
}

/** Reorder visible slots while retaining hidden/unavailable references in their saved positions. */
export function moveSidebarLocation(
  preferences: SidebarLocations,
  locations: readonly { path: string }[],
  path: string,
  before?: string,
): string[] | undefined {
  const displayed = displayedSidebarLocations(preferences, locations);
  if (
    !displayed.includes(path) ||
    (before !== undefined && before !== trashLocation && !displayed.includes(before))
  )
    return;
  const next = reorder(displayed, path, before === trashLocation ? undefined : before);
  if (next.every((item, index) => item === displayed[index])) return;
  const visible = new Set(displayed);
  let index = 0;
  return sidebarLocationOrder(preferences.locations, locations).map((item) =>
    visible.has(item) ? next[index++]! : item,
  );
}
