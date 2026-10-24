import path from 'node:path';
import { ensureElectronHeaders } from './headers';

const pinnedOptions = new Set([
  'nodedir',
  'devdir',
  'target',
  'arch',
  'target-arch',
  'dist-url',
  'disturl',
  'tarball',
  'force-process-config',
]);

function inheritedOption(name: string): string | undefined {
  const prefix = /^(?:npm_package_config_node_gyp_|npm_config_)/i.exec(name);
  return prefix ? name.slice(prefix[0].length).replaceAll('_', '-').toLowerCase() : undefined;
}

/** node-gyp applies npm environment overrides after CLI options; retain the target's CLI flags. */
export function bindRebuildHeaders(
  headers: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (path.basename(headers) !== 'node' || path.basename(path.dirname(headers)) !== 'include')
    throw new Error('Native rebuild requires the verified Electron include/node directory.');
  for (const name of Object.keys(environment)) {
    const option = inheritedOption(name);
    if (option && pinnedOptions.has(option)) delete environment[name];
  }
  // The header archive is shared across architectures. arch/target stay on each worker's CLI,
  // allowing Forge's parallel targets to use the same directory without an environment race.
  environment.npm_package_config_node_gyp_nodedir = path.resolve(headers, '../..');
}

export async function prepareNativeRebuild(options: {
  appRoot: string;
  electronVersion: string;
  arch: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<void> {
  const headers = await ensureElectronHeaders(options);
  bindRebuildHeaders(headers, options.environment);
}
