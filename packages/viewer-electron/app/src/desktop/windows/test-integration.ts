import path from 'node:path';

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
    !dataDirectory ||
    !path.isAbsolute(requested) ||
    !path.isAbsolute(dataDirectory) ||
    path.resolve(dataDirectory) === path.resolve(defaultDataDirectory)
  )
    throw new Error('A test shell home requires an isolated native acceptance profile.');
  const relative = path.relative(dataDirectory, requested);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error('The test shell home must be inside the isolated acceptance profile.');
  return requested;
}
