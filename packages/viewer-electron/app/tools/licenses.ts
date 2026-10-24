import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ensureElectronRuntime } from './native-build/runtime';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
type Package = {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
};
export async function licenseInventory() {
  const raw = JSON.parse(
    (
      await exec('pnpm', ['licenses', 'list', '--prod', '--json'], {
        cwd: root,
        maxBuffer: 8_000_000,
      })
    ).stdout,
  ) as Record<string, Package[]>;
  const entries: {
    name: string;
    versions: string[];
    license: string;
    homepage?: string;
    notices: { file: string; sha256: string }[];
  }[] = [];
  const text: string[] = [
    'Viewer third-party notices\n\nDeclared production packages, including optional packages. Bundling may eliminate unused code. Electron/Chromium and Open CASCADE notices are also supplied separately.\n\nnode-pty 1.1.0 is modified during packaging to apply macOS terminal settings to the owned PTY master for App Sandbox compatibility. Source and exact patch: https://github.com/plurid/viewer/blob/main/packages/viewer-electron/app/forge.config.ts\n',
  ];
  for (const item of Object.values(raw)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const notices: { file: string; sha256: string }[] = [];
    let license = item.license;
    // pnpm's license report may retain virtual-store paths from a prior
    // installation. Resolve the installed package when those paths are absent.
    const directories = [];
    for (const directory of [
      ...item.paths,
      path.resolve(root, '../../..', 'node_modules', item.name),
    ]) {
      if ((await stat(directory).catch(() => undefined))?.isDirectory())
        directories.push(directory);
    }
    if (item.name.startsWith('@napi-rs/canvas-')) {
      // Platform binaries share the canvas project's MIT license. Their npm
      // manifests declare MIT but omit its text; include the parent notice.
      const parent = path.resolve(root, '../../..', 'node_modules/@napi-rs/canvas');
      if ((await stat(parent).catch(() => undefined))?.isDirectory()) directories.push(parent);
    }
    for (const directory of [...new Set(directories)]) {
      const files = (await readdir(directory))
        .filter((name) => /^(license|licence|copying|notice)(?:[.-].*)?$/i.test(name))
        .sort();
      for (const file of files) {
        const content = await readFile(path.join(directory, file), 'utf8').catch(() => undefined);
        if (content === undefined) continue;
        const sha256 = createHash('sha256').update(content).digest('hex');
        if (notices.some((notice) => notice.sha256 === sha256)) continue;
        if (license === 'Unknown' && content.startsWith('delicense\n')) license = 'delicense';
        notices.push({ file, sha256 });
        text.push(
          `\n${'='.repeat(72)}\n${item.name} ${item.versions.join(', ')} — ${file}\n\n${content}\n`,
        );
      }
    }
    entries.push({
      name: item.name,
      versions: item.versions,
      license,
      homepage: item.homepage,
      notices,
    });
  }
  const runtime = await ensureElectronRuntime({ appRoot: root });
  await mkdir(path.join(root, 'assets/licenses'), { recursive: true });
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
    const content = await readFile(path.join(runtime.distRoot, file));
    await writeFile(
      path.join(root, 'assets/licenses', file === 'LICENSE' ? 'electron.txt' : file),
      content,
    );
  }
  const inventory = {
    version: 1,
    electron: runtime.version,
    packages: entries,
    unresolved: entries
      .filter((entry) => entry.license === 'Unknown' || !entry.notices.length)
      .map((entry) => entry.name),
  };
  await writeFile(path.join(root, 'assets/licenses/third-party-notices.txt'), text.join(''));
  await writeFile(
    path.join(root, 'assets/licenses/dependencies.json'),
    JSON.stringify(inventory, null, 2) + '\n',
  );
  if (inventory.unresolved.length)
    throw new Error('License notices need review: ' + inventory.unresolved.join(', '));
  console.log(
    `Bundled license notices: ${entries.length} production packages plus Electron ${runtime.version}, Chromium and existing CAD notices.`,
  );
  return inventory;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await licenseInventory();
