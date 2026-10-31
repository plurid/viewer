import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type PluridExtension = '.js' | '.mjs';

/** Read the installed entry's reachable chunks; preserved older builds are not runtime inputs. */
export async function pluridCameraSource(extension: PluridExtension = '.js'): Promise<string> {
  const entry = createRequire(import.meta.url).resolve('@plurid/plurid-react');
  const directory = path.dirname(entry);
  const pending = [entry.replace(/\.js$/, extension)];
  const visited = new Set<string>();
  const owners: string[] = [];
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const code = await readFile(file, 'utf8');
    if (/var getTransform = (?:toolkit\.)?createSelector\(/.test(code)) owners.push(code);
    for (const match of code.matchAll(/["'](\.\/chunk-[^"']+\.(?:mjs|js))["']/g))
      pending.push(path.join(directory, match[1]!));
  }
  if (owners.length !== 1)
    throw new Error('Review the Plurid camera selector owner after updating Plurid.');
  return owners[0]!;
}
