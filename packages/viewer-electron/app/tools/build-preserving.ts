import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseEnvironment } from './release-environment';

const payload = fileURLToPath(new URL('./build-preserving-payload.ts', import.meta.url));

// Forge and its plugins can read the environment as soon as they are imported.
execFileSync(
  process.execPath,
  ['--import', import.meta.resolve('tsx'), payload, ...process.argv.slice(2)],
  {
    env: releaseEnvironment(process.env),
    stdio: 'inherit',
  },
);
