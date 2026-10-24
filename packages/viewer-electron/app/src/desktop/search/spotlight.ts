import { execFile } from 'node:child_process';

/** Spotlight runs only in direct macOS builds; the App Store sandbox has no mdfind. */
export const spotlightAvailable = process.platform === 'darwin' && !process.mas;

function mdfind(args: string[], signal?: AbortSignal, timeout = 3000): Promise<string[]> {
  return new Promise((resolve, reject) =>
    execFile(
      '/usr/bin/mdfind',
      args,
      { signal, timeout, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.split('\n').filter(Boolean))),
    ),
  );
}
/** File paths under `root` whose names contain `query`, from the Spotlight index. */
export function spotlightNames(
  root: string,
  query: string,
  signal: AbortSignal,
): Promise<string[]> {
  return mdfind(['-onlyin', root, '-name', query], signal);
}
/** A Spotlight query matching a Finder tag by its exact name, ignoring case. */
export function tagQuery(tag: string): string {
  const name = tag.normalize('NFC').trim();
  if (!name || name.length > 255 || /[\p{Cc}]/u.test(name))
    throw new Error('Enter a tag name without control characters.');
  return `kMDItemUserTags == "${name.replace(/[\\"]/g, (character) => '\\' + character)}"c`;
}
/** Files under `root` that carry the Finder tag `tag`. */
export function spotlightTagged(
  root: string,
  tag: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!spotlightAvailable)
    return Promise.reject(
      new Error('Finding files by tag needs Spotlight, which this build cannot use.'),
    );
  return mdfind(['-onlyin', root, tagQuery(tag)], signal, 10000);
}
