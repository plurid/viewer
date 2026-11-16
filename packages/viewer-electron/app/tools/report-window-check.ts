import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { temporaryRoot } from './temporary';

if (process.env.VIEWER_TEST_PRESERVE !== '1' || process.env.VIEWER_TEST_NO_REMOVAL !== '1')
  throw new Error('Set both VIEWER_TEST_PRESERVE=1 and VIEWER_TEST_NO_REMOVAL=1.');
const root = await temporaryRoot('viewer-report-window-');
for (const [entry, name] of [
  ['tests/native/report-window.ts', 'report-window'],
  ['src/report-preload.ts', 'report-preload'],
]) {
  await build({
    ssr: { noExternal: true },
    configFile: false,
    logLevel: 'warn',
    build: {
      target: 'node24',
      ssr: true,
      emptyOutDir: false,
      outDir: root,
      minify: false,
      lib: { entry, formats: ['cjs'], fileName: () => name + '.cjs' },
      rollupOptions: { external: [...builtinModules, 'electron'] },
    },
  });
}
const require = createRequire(import.meta.url);
const binary = require('electron') as string;
const child = spawn(binary, [path.join(root, 'report-window.cjs'), root], {
  stdio: 'inherit',
  timeout: 120000,
});
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});
process.stdout.write('Report window evidence: ' + root + '\n');
