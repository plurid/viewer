/** Reproducible SSF 0.11.2 vendoring; no install scripts, package pruning or cleanup. */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { x as extract } from 'tar';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = {
  version: '0.11.2',
  url: 'https://registry.npmjs.org/ssf/-/ssf-0.11.2.tgz',
  integrity:
    'sha512-+idbmIXoYET47hH+d7dfm2epdOMUDjqcB4648sTZ+t2JwoyBFL/insLfB/racrDmsKB3diwsDA696pZMieAC5g==',
  sourceSHA256: '27b543bb7440feb42c821ab58fc401a60d4affbc611d96bcd6bad31b09e5cb87',
};
export async function vendorSSF(archive: string) {
  const bytes = await readFile(archive);
  if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== upstream.integrity)
    throw new Error('SSF archive differs from its pin.');
  await mkdir(path.join(appRoot, 'out'), { recursive: true });
  const work = await mkdtemp(path.join(appRoot, 'out/ssf-source-'));
  await extract({
    file: archive,
    cwd: work,
    strict: true,
    keep: true,
    filter: (_name, item) =>
      'type' in item &&
      ['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(item.type),
  });
  const source = await readFile(path.join(work, 'package/ssf.js'), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== upstream.sourceSHA256)
    throw new Error('SSF source differs from its pin.');
  const footer =
    "if(typeof module !== 'undefined' && typeof DO_NOT_EXPORT_SSF === 'undefined') module.exports = SSF;";
  if (!source.includes(footer)) throw new Error('Review the SSF export adapter.');
  const module = source.replace(footer, 'export default SSF;');
  const directory = path.join(appRoot, 'assets/vendor');
  await mkdir(directory, { recursive: true });
  const save = async (file: string, data: string) => {
    const existing = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (existing !== undefined) {
      if (existing !== data)
        throw new Error('Existing vendored file differs and was preserved: ' + file);
      return;
    }
    await writeFile(file, data, { flag: 'wx' });
  };
  await save(path.join(directory, 'ssf-0.11.2.mjs'), module);
  await save(
    path.join(appRoot, 'assets/licenses/ssf-0.11.2.txt'),
    await readFile(path.join(work, 'package/LICENSE'), 'utf8'),
  );
  await save(
    path.join(directory, 'ssf-0.11.2.json'),
    JSON.stringify(
      {
        ...upstream,
        license: 'Apache-2.0',
        adapter:
          'Only the final CommonJS export is replaced with export default SSF. The standalone distribution includes its fraction formatter; no external runtime dependency.',
        moduleSHA256: createHash('sha256').update(module).digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('SSF source and license retained:', work);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Provide the retained checksum-pinned SSF 0.11.2 archive.');
  await vendorSSF(process.argv[2]);
}
