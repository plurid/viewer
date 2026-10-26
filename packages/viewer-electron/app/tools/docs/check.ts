import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as prettier from 'prettier';
import { checkDocuments, documentationSections } from './markdown';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const git = promisify(execFile);
const [{ stdout }, { stdout: deleted }] = await Promise.all([
  git('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  }),
  git('git', ['ls-files', '-z', '--deleted'], { cwd: root }),
]);
const files = new Set(stdout.split('\0').filter(Boolean));
for (const file of deleted.split('\0')) files.delete(file);
const documents = new Map<string, string>();
for (const file of [...files].filter((file) => file.endsWith('.md')).sort()) {
  const absolute = path.join(root, file);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('Expected a regular document: ' + file);
  documents.set(file, await readFile(absolute, 'utf8'));
}
const scripts = new Set<string>();
for (const file of ['package.json', 'packages/viewer-electron/app/package.json'])
  Object.keys(JSON.parse(await readFile(path.join(root, file), 'utf8')).scripts).forEach((name) =>
    scripts.add(name),
  );
const problems = checkDocuments(documents, files, scripts);
for (const directory of ['docs', ...documentationSections.map((section) => 'docs/' + section)])
  if (!documents.has(directory + '/README.md'))
    problems.push({ file: directory, message: 'This documentation section needs a README index.' });
for (const [file, text] of documents) {
  const options = await prettier.resolveConfig(path.join(root, file));
  if (!(await prettier.check(text, { ...options, filepath: file, proseWrap: 'always' })))
    problems.push({ file, message: 'Run Markdown formatting.' });
}
const media = path.join(root, 'docs/media');
const manifest = JSON.parse(await readFile(path.join(media, 'manifest.json'), 'utf8')) as {
  assets: Record<string, { bytes: number; sha256: string }>;
};
let bytes = 0;
for (const file of await readdir(media)) {
  const info = await lstat(path.join(media, file));
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('Expected a regular media asset: ' + file);
  if (/\.(png|gif|mp4|webp|jpe?g)$/.test(file)) {
    bytes += info.size;
    const expected = manifest.assets[file];
    const actual = createHash('sha256')
      .update(await readFile(path.join(media, file)))
      .digest('hex');
    if (!expected || expected.bytes !== info.size || expected.sha256 !== actual)
      problems.push({
        file: 'docs/media/' + file,
        message: 'Asset differs from its capture manifest.',
      });
  }
}
for (const file of Object.keys(manifest.assets))
  if (!/^[a-z0-9-]+\.(png|gif|mp4|webp|jpe?g)$/.test(file) || !files.has('docs/media/' + file))
    problems.push({
      file: 'docs/media/manifest.json',
      message: 'Invalid or missing declared asset.',
    });
if (bytes > 20 * 1024 * 1024)
  problems.push({ file: 'docs/media', message: 'Documentation media exceeds the 20 MiB budget.' });
for (const problem of problems) console.error(problem.file + ': ' + problem.message);
if (problems.length) process.exitCode = 1;
else
  console.log(
    `Documentation checked: ${documents.size} Markdown files; ${(bytes / 1048576).toFixed(2)} MiB media.`,
  );
