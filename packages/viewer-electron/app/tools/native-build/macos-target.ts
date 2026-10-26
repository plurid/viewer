/** A helper built for an older macOS minimum can run with a newer Electron
 * minimum. A newer-only helper cannot safely be reused by an older target. */
export function compatibleMacOSMinimum(built: string, requested: string): boolean {
  const version = (value: string) =>
    /^\d{1,3}(?:\.\d{1,3}){0,2}$/.test(value) ? value.split('.').map(Number) : undefined;
  const previous = version(built);
  const target = version(requested);
  if (!previous || !target) return false;
  for (let index = 0; index < 3; index++) {
    const left = previous[index] ?? 0;
    const right = target[index] ?? 0;
    if (left !== right) return left < right;
  }
  return true;
}
