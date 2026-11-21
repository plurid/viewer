import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Canonicalizes a directory path across symlinks, falling back when it does not exist yet. */
export function resolveCanonicalDirectory(directory: string): string {
  try {
    return realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
}

/** True only when `dataDirectory` is an explicit absolute directory distinct from the real profile. */
export function isIsolatedDataDirectory(
  dataDirectory: string | undefined,
  defaultDataDirectory: string,
): boolean {
  return (
    !!dataDirectory &&
    path.isAbsolute(dataDirectory) &&
    resolveCanonicalDirectory(dataDirectory) !== resolveCanonicalDirectory(defaultDataDirectory)
  );
}

/** Hidden QA rendering and runtime overrides require an isolated non-default profile directory. */
export function isBackgroundTest(options: {
  renderTest: boolean;
  backgroundTest: boolean;
  dataDirectory?: string;
  defaultDataDirectory: string;
}): boolean {
  return (
    options.renderTest &&
    options.backgroundTest &&
    isIsolatedDataDirectory(options.dataDirectory, options.defaultDataDirectory)
  );
}

/** Native acceptance may install its shell script only inside its isolated profile. */
export function isolatedShellHome(options: {
  requested?: string;
  renderTest: boolean;
  dataDirectory?: string;
  defaultDataDirectory: string;
}): string | undefined {
  if (!options.requested) return undefined;
  const { requested, renderTest, dataDirectory, defaultDataDirectory } = options;
  if (
    !renderTest ||
    !path.isAbsolute(requested) ||
    !isIsolatedDataDirectory(dataDirectory, defaultDataDirectory)
  )
    throw new Error('A test shell home requires an isolated native acceptance profile.');
  const relative = path.relative(dataDirectory!, requested);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error('The test shell home must be inside the isolated acceptance profile.');
  return requested;
}
