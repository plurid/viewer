export interface FileChange {
  source: string;
  destination: string;
}
/** One lookup table per logical batch, with longest ancestor ownership and simultaneous cycles. */
export function pathMapper(changes: readonly FileChange[]): (value: string) => string {
  const targets = new Map(changes.map((change) => [change.source, change.destination]));
  return (value) => {
    let ancestor = value;
    while (ancestor) {
      const destination = targets.get(ancestor);
      if (destination !== undefined) return destination + value.slice(ancestor.length);
      const separator = ancestor.lastIndexOf('/');
      if (separator < 0 || ancestor === '/') break;
      ancestor = ancestor.slice(0, separator) || '/';
    }
    return value;
  };
}
export function remapPath(value: string, changes: readonly FileChange[]): string {
  return pathMapper(changes)(value);
}
