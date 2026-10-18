import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional local development overlay. Release qualification requires a clean registry install.
// Keep old build files:
// their removal requires separate approval under the workspace's Trash policy.
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(app, '../../../../plurid');
const consumer = path.resolve(app, '../../../node_modules');
const packages = [
  'packages/plurid-web/plurid-core',
  'packages/plurid-web/plurid-works',
  'packages/plurid-utilities',
].flatMap((group) =>
  readdirSync(path.join(source, group), { withFileTypes: true }).flatMap((entry) => {
    const directory = path.join(source, group, entry.name);
    const manifest = path.join(directory, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifest)) return [];
    const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string };
    return [{ name, path: directory }];
  }),
);

if (!process.argv.includes('--no-build')) {
  for (const name of ['@plurid/plurid-data', '@plurid/plurid-engine', '@plurid/plurid-react']) {
    const project = packages.find((entry) => entry.name === name);
    if (!project) throw new Error(`Missing sibling package: ${name}`);
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {build} from 'tsup'; await build({config:'tsup.config.ts',clean:false});",
      ],
      { cwd: project.path, stdio: 'inherit' },
    );
  }
}

const data = packages.find((entry) => entry.name === '@plurid/plurid-data');
if (
  !data ||
  !readFileSync(path.join(data.path, 'distribution/index.d.ts'), 'utf8').includes('click-to-scroll')
)
  throw new Error('Build the sibling Plurid click-to-scroll source before syncing.');

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: source,
  encoding: 'utf8',
}).trim();
const dirty = !!execFileSync('git', ['status', '--porcelain'], {
  cwd: source,
  encoding: 'utf8',
}).trim();
let copied = 0;
for (const project of packages) {
  if (!project.name?.startsWith('@plurid/')) continue;
  const built = path.join(project.path, 'distribution');
  const installed = path.join(consumer, project.name);
  if (!existsSync(installed) || !existsSync(built)) continue;
  const target = path.join(installed, 'distribution');
  if (
    lstatSync(installed).isSymbolicLink() ||
    (existsSync(target) && lstatSync(target).isSymbolicLink())
  )
    throw new Error(`Expected an extracted package, found a symlink: ${target}`);
  cpSync(built, target, { recursive: true });
  writeFileSync(
    path.join(target, '.synced-from.json'),
    JSON.stringify(
      { commit, dirty, at: new Date().toISOString(), package: project.name },
      null,
      2,
    ) + '\n',
  );
  copied++;
}
console.log(
  `Synced ${copied} generated Plurid packages from ${commit}${dirty ? ' (modified)' : ''}.`,
);
console.log(
  'Development overlay applied. This installation cannot qualify for release; use a fresh checkout and package store for registry verification.',
);
