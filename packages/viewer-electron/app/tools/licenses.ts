import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ensureElectronRuntime } from './native-build/runtime';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A file a package keeps its license or notices in: LICENSE, COPYING, NOTICE, and the notices of
 * what a build links in, such as djvu-rs's THIRD_PARTY_NOTICES for the crates in its WebAssembly. */
export const noticeFile = (name: string) =>
  /^(?:third[-_]party[-_])?(?:licen[cs]es?|copying|notices?)(?:[.-].*)?$/i.test(name);
const exec = promisify(execFile);
type Package = {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
};
export async function licenseInventory() {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
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
    'Viewer third-party notices\n\nDeclared production packages, including optional packages. Bundling may eliminate unused code. Electron/Chromium and Open CASCADE notices are also supplied separately.\n\nnode-pty 1.1.0 is modified during packaging to apply macOS terminal settings to the owned PTY master for App Sandbox compatibility. Source and exact patch, as released: ' +
      `https://github.com/plurid/viewer/blob/v${version}/packages/viewer-electron/app/forge.config.ts\n`,
  ];
  text.push(
    '\nOffice layout includes the unmodified Noto Sans CJK 2.004 and Noto Serif CJK 2.001 collections (SIL Open Font License 1.1), providing Japanese, Korean, Simplified/Traditional Chinese and Hong Kong serif/sans/monospace faces. The original copyrights and license are in noto-cjk-2.004.txt. The exact upstream commit, URLs and SHA-256 values are recorded in src/desktop/previews/office-font-manifest.ts; the fonts are bundled inside the Office virtual filesystem and never installed into the host OS.\n',
    '\nOffice number/date formatting uses vendored SheetJS SSF 0.11.2 (Apache 2.0). Its original license is supplied as ssf-0.11.2.txt. Source, published archive integrity, source/module SHA256 values and the sole ESM export adaptation are recorded in assets/vendor/ssf-0.11.2.json and tools/vendor-ssf.ts in the Viewer source.\n',
    '\nCamera RAW previews bundle LibRaw 0.22.2 as a separate replaceable shared library under LGPL 2.1 or later. Complete original source archive, LGPL/CDDL licenses, copyright, helper source, pinned source URL/checksum and build instructions are supplied in viewer-raw-v3-darwin-<arch>. No decoder is downloaded at runtime.\n',
    '\nPDF/JPEG optimization also bundles qpdf 12.4.2 (Apache 2.0) and libjpeg-turbo 3.1.3 (IJG/BSD/zlib licenses). Their complete corresponding source archives, original license/notice files, pinned upstream URLs, checksums and build instructions are supplied in viewer-optimizers-darwin-<arch>. They link only to macOS system libraries; no runtime package manager or cloud service is required.\n',
    '\nViewer image and media processors\n\nmacOS bundles official FFmpeg 9.0.2 under LGPL 2.1 or later, built without GPL, nonfree or network components. Its complete corresponding source archive, license, pinned source URL/checksum and exact configure command are supplied alongside the binaries in viewer-processors-darwin-<arch>/sources, COPYING.LGPLv2.1 and ffmpeg-build.txt.\n\nSharp 0.35.5 (Apache 2.0), libvips and their pinned supporting packages are supplied in the same resource directory. The manifest records exact versions, upstream archive integrity and every bundled file hash; their original license texts, including libvips third-party notices, remain inside node_modules. These libraries run in a separate image utility process; they are not downloaded or installed at runtime.\n',
  );
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
      const files = (await readdir(directory)).filter(noticeFile).sort();
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
