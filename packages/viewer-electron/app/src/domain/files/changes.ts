export interface FileChange {
  source: string;
  destination: string;
}
/** One lookup table per logical batch, with longest ancestor ownership and simultaneous cycles. */
export function pathMapper(
  changes: readonly FileChange[],
  normalize: (value: string) => string = (value) => value,
): (value: string) => string {
  const targets = new Map(changes.map((change) => [normalize(change.source), change.destination]));
  return (value) => {
    const normalized = normalize(value);
    let ancestor = normalized;
    while (ancestor) {
      const destination = targets.get(ancestor);
      if (destination !== undefined) {
        if (normalized === ancestor) return destination;
        const suffix = normalized.slice(ancestor.length).replace(/^\/+/, '');
        return destination.replace(/\/+$/, '') + '/' + suffix;
      }
      const separator = ancestor.lastIndexOf('/');
      if (separator < 0 || ancestor === '/') break;
      ancestor = ancestor.slice(0, separator) || '/';
    }
    return value;
  };
}
