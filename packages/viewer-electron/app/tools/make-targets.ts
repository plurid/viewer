import { MakerZIP } from '@electron-forge/maker-zip';
import type { ForgePlatform } from '@electron-forge/shared-types';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const directMakers = () => [new MakerZIP({}, ['darwin'])];
type MakeTarget = Pick<
  MakerZIP,
  'platforms' | 'isSupportedOnCurrentPlatform' | 'ensureExternalBinariesExist' | 'clone'
>;

async function checkMakeTargets(platform: ForgePlatform, targets?: string) {
  const configured = directMakers();
  const names = targets ? targets.split(',') : configured.map((maker) => maker.name);
  // Forge 8 resolves both installed makers and local modules with this resolver.
  const require = createRequire(import.meta.url);
  const cli = createRequire(require.resolve('@electron-forge/cli/package.json'));
  const core = pathToFileURL(cli.resolve('@electron-forge/core'));
  const { importSearch } = await import(new URL('../util/import-search.js', core).href);
  let hasApplicableMaker = false;
  for (const name of names) {
    if (!name) throw new Error('A make target is missing its maker name.');
    let maker: MakeTarget | undefined = configured.find((entry) => entry.name === name);
    if (!maker) {
      const Maker = await importSearch(process.cwd(), [name]);
      if (!Maker) throw new Error(`Could not find the requested maker: ${name}`);
      maker = new Maker() as MakeTarget;
    }
    if (!maker.platforms.includes(platform)) continue;
    if (!maker.isSupportedOnCurrentPlatform())
      throw new Error(`Cannot make for ${platform} with ${name} on this host.`);
    maker.ensureExternalBinariesExist();
    const instance = maker.clone?.();
    if (typeof instance?.prepareConfig !== 'function' || typeof instance.make !== 'function')
      throw new Error(`The requested maker does not implement the Forge maker interface: ${name}`);
    hasApplicableMaker = true;
  }
  if (!hasApplicableMaker) throw new Error(`No requested maker targets ${platform}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkMakeTargets(process.argv[2] as ForgePlatform, process.argv[3]);
