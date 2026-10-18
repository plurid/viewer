import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plan from './plurid-release.json' with { type: 'json' };
import {
  inspectInstall,
  registryPackage,
  updatedManifest,
  verifyDistribution,
} from './lib/plurid-registry';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(app, '../../..');
const args = process.argv.slice(2);
if (args.some((arg) => !['--update', '--registry', '--plan'].includes(arg)))
  throw new Error('Usage: plurid-registry.ts [--plan | --update | --registry]');
if (args.length > 1) throw new Error('Choose one Plurid registry operation.');

if (args.includes('--plan')) {
  console.log(JSON.stringify(plan, null, 2));
} else if (args.includes('--update')) {
  const originalLock = readFileSync(path.join(workspace, 'pnpm-lock.yaml'));
  // Check the whole coordinated release before writing anything. Authentication is unnecessary.
  await Promise.all(
    Object.entries(plan.versions).map(([name, version]) => registryPackage(name, version)),
  );
  const current = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'));
  const proposed = updatedManifest(current, plan);
  // Resolve a real lockfile in a new workspace; retain the current source-synced installation.
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'viewer-plurid-update-'));
  const relativeApp = path.relative(workspace, app);
  mkdirSync(path.join(temporary, relativeApp), { recursive: true });
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'])
    cpSync(path.join(workspace, file), path.join(temporary, file));
  writeFileSync(
    path.join(temporary, relativeApp, 'package.json'),
    JSON.stringify(proposed, null, 2) + '\n',
  );
  console.log('Resolving published versions; preserving work in', temporary);
  execFileSync(
    'pnpm',
    [
      'install',
      '--lockfile-only',
      '--ignore-scripts',
      '--store-dir',
      path.join(temporary, 'store'),
    ],
    {
      cwd: temporary,
      stdio: 'inherit',
    },
  );
  // Do not replace concurrent edits made while registry resolution was running.
  if (
    JSON.stringify(JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'))) !==
    JSON.stringify(current)
  )
    throw new Error(
      `Viewer manifest changed during resolution. Prepared files remain in ${temporary}`,
    );
  if (!readFileSync(path.join(workspace, 'pnpm-lock.yaml')).equals(originalLock))
    throw new Error(
      `Viewer lockfile changed during resolution. Prepared files remain in ${temporary}`,
    );
  cpSync(path.join(temporary, 'pnpm-lock.yaml'), path.join(workspace, 'pnpm-lock.yaml'));
  writeFileSync(path.join(app, 'package.json'), JSON.stringify(proposed, null, 2) + '\n');
  console.log('Updated exact Plurid pins and registry lockfile. Review and commit both files.');
  console.log(
    'Qualify from a fresh checkout and package store; current node_modules was preserved.',
  );
} else {
  const installed = inspectInstall(app, workspace, plan);
  if (args.includes('--registry')) {
    for (const entry of installed) {
      const data = await registryPackage(entry.manifest.name, entry.manifest.version);
      const url = new URL(data.dist.tarball);
      if (url.origin !== 'https://registry.npmjs.org')
        throw new Error('Unexpected registry tarball origin.');
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok)
        throw new Error(`Cannot download ${entry.manifest.name}: HTTP ${response.status}`);
      verifyDistribution(entry, Buffer.from(await response.arrayBuffer()), data.dist.integrity);
    }
  }
  console.log(
    `Verified ${installed.length} Plurid packages${args.includes('--registry') ? ' against registry tarball bytes' : ''}.`,
  );
  for (const { manifest } of installed) console.log(`${manifest.name}@${manifest.version}`);
}
