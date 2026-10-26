/** A name as a command's: “open docs” is OpenDocs, as vim's :command names need a
 * capital; undefined when nothing of it can be one. */
export function commandName(name: string): string | undefined {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join('');
  return /^[A-Z][A-Za-z0-9]{0,30}$/.test(joined) ? joined : undefined;
}
