/** Variables that change how Electron, Node or the dynamic loader start a child. */
export const reservedEnvironment = (key: string) =>
  key.startsWith('DYLD_') || key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS';

/** Viewer's environment for a user command or shell, without its own loader settings. */
export function childEnvironment(extra: Record<string, string | undefined> = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter(
      ([key, value]) => value !== undefined && !reservedEnvironment(key),
    ),
  ) as Record<string, string>;
}
