import type { FileEntry } from '../contracts';
import { sameSelection } from '../files/entries';

/** Identity, not a similar name, is evidence of a rename. Hard links with more
 * than one possible destination require an explicit file choice. */
export function renamedSibling(
  source: FileEntry,
  entries: readonly FileEntry[],
): FileEntry | undefined {
  if (!source.identity) return;
  const matches = entries.filter(
    (entry) =>
      entry.kind === 'file' &&
      !entry.directory &&
      entry.path !== source.path &&
      sameSelection(entry, source),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
