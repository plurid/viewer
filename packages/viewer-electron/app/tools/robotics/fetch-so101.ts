/** Download a pinned public model corpus into a new folder; preserve incomplete attempts. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(
  await readFile(
    new URL('../../tests/fixtures/robotics/so101/manifest.json', import.meta.url),
    'utf8',
  ),
) as {
  repository: string;
  revision: string;
  files: { path: string; sha256: string; bytes: number }[];
};
if (!process.argv[2]) throw new Error('Provide a new destination folder for the SO-101 corpus.');
const destination = path.resolve(process.argv[2]);
await mkdir(destination);
for (const file of manifest.files) {
  const url = `https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/${manifest.revision}/${file.path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok || !response.body)
    throw new Error(`Model download failed: ${response.status} ${file.path}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > file.bytes) throw new Error('The model download exceeds its pinned size.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (
    bytes.length !== file.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== file.sha256
  )
    throw new Error('The model download does not match its pinned hash.');
  const target = path.join(destination, file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  console.log(file.path);
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
});
console.log('Retained model corpus:', destination);
