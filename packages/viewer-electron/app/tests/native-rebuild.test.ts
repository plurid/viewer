import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { bindRebuildHeaders } from '../tools/native-build/rebuild';

const run = promisify(execFile);

describe('verified Electron headers for native rebuilds', () => {
  it('binds the supported nodedir option while leaving per-target CLI flags authoritative', async () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      npm_config_nodedir: '/must-not-use',
      NPM_CONFIG_TARGET: '1.0.0',
      npm_config_arch: 'ia32',
      npm_package_config_node_gyp_arch: 'ia32',
      NPM_PACKAGE_CONFIG_NODE_GYP_NODEDIR: '/must-not-use-either',
      npm_config_force_process_config: 'true',
      npm_config_tarball: '/must-not-extract',
      npm_config_python: '/configured/python',
    };
    const headers = path.resolve('/generated native cache/electron/44.7.0/include/node');
    bindRebuildHeaders(headers, environment);
    expect(environment.npm_config_python).toBe('/configured/python');
    expect(environment.npm_config_tarball).toBeUndefined();
    expect(environment.NPM_PACKAGE_CONFIG_NODE_GYP_NODEDIR).toBeUndefined();

    // Resolve the actual node-gyp pinned behind Forge/rebuild; only parse options, never build or clean.
    const require = createRequire(import.meta.url);
    const forgeRequire = createRequire(require.resolve('@electron-forge/shared-types'));
    const rebuildRequire = createRequire(forgeRequire.resolve('@electron/rebuild'));
    const nodeGyp = rebuildRequire.resolve('node-gyp');
    const nodeGypRequire = createRequire(nodeGyp);
    expect(nodeGypRequire('node-gyp/package.json').version).toBe('12.4.0');
    for (const arch of ['arm64', 'x64']) {
      const result = await run(
        process.execPath,
        [
          '-e',
          `
            const gyp = require(process.argv[1])();
            gyp.parseArgv([
              'node', 'node-gyp', 'configure',
              '--target=44.7.0', '--arch=' + process.argv[2],
              '--dist-url=https://electronjs.org/headers'
            ]);
            process.stdout.write(JSON.stringify({
              nodedir: gyp.opts.nodedir,
              target: gyp.opts.target,
              arch: gyp.opts.arch,
              forceProcessConfig: gyp.opts['force-process-config']
            }));
          `,
          nodeGyp,
          arch,
        ],
        { env: environment, maxBuffer: 128 * 1024 },
      );
      expect(JSON.parse(result.stdout)).toEqual({
        nodedir: path.resolve(headers, '../..'),
        target: '44.7.0',
        arch,
      });
    }
  });

  it('does not bind an arbitrary directory as the verified header root', () => {
    const environment = { npm_config_nodedir: '/kept' };
    expect(() => bindRebuildHeaders('/unverified/node', environment)).toThrow('include/node');
    expect(environment).toEqual({ npm_config_nodedir: '/kept' });
  });
});
