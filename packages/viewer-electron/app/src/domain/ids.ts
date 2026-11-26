/** A name as a lowercase, hyphenated slug, or `fallback` when nothing of it is left. */
export function slugOf(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  );
}

/**
 * A readable ID for something new: its name's slug and the time. Two made in the same
 * millisecond would share it, so an ID already `taken` gets a counter.
 */
export function slugID(
  name: string,
  fallback: string,
  taken: Iterable<string> = [],
  now = Date.now(),
): string {
  const slug = slugOf(name, fallback);
  const time = now.toString(36);
  const used = new Set(taken);
  for (let count = 1; ; count++) {
    const suffix = count === 1 ? '-' + time : `-${time}-${count}`;
    const id = slug.slice(0, 100 - suffix.length).replace(/-$/, '') + suffix;
    if (!used.has(id)) return id;
  }
}
