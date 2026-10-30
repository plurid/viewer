import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Viewer's macOS minimum: LSMinimumSystemVersion and the target of every bundled helper. It is
 * at least Electron's own minimum; build-helpers.ts refuses an Electron that needs more. */
export const macOSMinimum = '14.0';

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

/** The macOS minimum (`minos`) that `vtool -show-build` reports for a Mach-O file. */
export function buildVersionMinimum(output: string): string | undefined {
  const minimums = [...output.matchAll(/^\s*minos\s+(\S+)\s*$/gm)].map((match) => match[1]!);
  // A universal file reports one slice per architecture; the highest governs.
  return minimums.reduce<string | undefined>(
    (highest, value) =>
      highest === undefined || compatibleMacOSMinimum(highest, value) ? value : highest,
    undefined,
  );
}

/** Refuses a bundled binary that needs a newer macOS than `minimum`. */
export async function assertMacOSMinimum(file: string, minimum = macOSMinimum): Promise<string> {
  const { stdout } = await promisify(execFile)('/usr/bin/xcrun', ['vtool', '-show-build', file]);
  const built = buildVersionMinimum(stdout);
  if (!built || !compatibleMacOSMinimum(built, minimum))
    throw new Error(
      `${file} needs macOS ${built ?? 'of an unknown version'}; Viewer supports macOS ${minimum}.`,
    );
  return built;
}
