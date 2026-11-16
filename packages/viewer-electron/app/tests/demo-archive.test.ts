import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { demoArchiveCommand } from '../tools/demo-archive';
import { temporaryRoot } from '../tools/temporary';

const exec = promisify(execFile);

async function fixture() {
  const root = await temporaryRoot('viewer-demo-archive-');
  const source = path.join(root, 'Generated account', 'Saved tools');
  const output = path.join(root, 'output');
  for (const name of ['Front', 'Rear']) {
    const tool = path.join(source, name);
    await mkdir(path.join(tool, 'runtime'), { recursive: true });
    await mkdir(path.join(tool, 'assets'));
    await mkdir(path.join(tool, 'empty'));
    await writeFile(path.join(tool, 'index.html'), `<title>${name}</title>`);
    await writeFile(path.join(tool, 'canvas.viewer.json'), JSON.stringify({ name }));
    await writeFile(path.join(tool, 'runtime', 'tool.js'), 'export const ready = true;\n');
    await writeFile(path.join(tool, 'assets', 'mesh.bin'), Buffer.from([0, 1, 127, 255]));
    await writeFile(path.join(tool, 'LICENSE.txt'), 'Generated sample license.\n');
  }
  return { root, source, output };
}

it('builds one portable Viewer Demo folder, keeps staging and reports the exact checksum', async () => {
  const { source, output } = await fixture();
  await mkdir(path.join(source, '.private'));
  await mkdir(path.join(source, 'Front', 'runtime', '.cache'));
  for (const relative of [
    '.DS_Store',
    '.private/notes.txt',
    'Front/.DS_Store',
    'Front/runtime/.cache/cache.js',
    'Rear/assets/.secret',
  ])
    await writeFile(path.join(source, relative), 'Not for the archive.');
  await writeFile(path.join(source, 'README.txt'), 'Open Viewer Demo in Viewer.\n');
  const executable = path.join(source, 'Front', 'runtime', 'tool.js');
  await chmod(executable, 0o755);
  if (process.platform === 'darwin')
    await exec('/usr/bin/xattr', [
      '-w',
      'com.viewer.demo-test',
      'Generated owner metadata',
      executable,
    ]);
  const originalNames = (await readdir(source, { recursive: true })).sort();
  const print = vi.fn();
  const result = await demoArchiveCommand([source, output], print);
  const bytes = await readFile(result.archive);
  const entries = unzipSync(bytes);
  const names = Object.keys(entries).sort();
  const expected = ['Viewer Demo/', 'Viewer Demo/README.txt'];
  for (const tool of ['Front', 'Rear'])
    expected.push(
      `Viewer Demo/${tool}/`,
      `Viewer Demo/${tool}/LICENSE.txt`,
      `Viewer Demo/${tool}/assets/`,
      `Viewer Demo/${tool}/assets/mesh.bin`,
      `Viewer Demo/${tool}/canvas.viewer.json`,
      `Viewer Demo/${tool}/empty/`,
      `Viewer Demo/${tool}/index.html`,
      `Viewer Demo/${tool}/runtime/`,
      `Viewer Demo/${tool}/runtime/tool.js`,
    );
  expect(names).toEqual(expected.sort());
  expect(names.every((name) => name.startsWith('Viewer Demo/'))).toBe(true);
  expect(names.some((name) => name.includes(source) || name.includes(os.homedir()))).toBe(false);
  expect(names.some((name) => name.split('/').includes(os.userInfo().username))).toBe(false);
  expect(names.some((name) => name.includes('__MACOSX') || /(^|\/)\./.test(name))).toBe(false);
  // ZIP extra fields and comments can carry owner metadata without appearing as entries.
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(bytes.readUInt16LE(end + 20)).toBe(0);
  let central = bytes.readUInt32LE(end + 16);
  for (let entry = 0; entry < names.length; entry++) {
    expect(bytes.readUInt32LE(central)).toBe(0x02014b50);
    expect(bytes.readUInt16LE(central + 30)).toBe(0);
    expect(bytes.readUInt16LE(central + 32)).toBe(0);
    central += 46 + bytes.readUInt16LE(central + 28);
  }
  expect(Buffer.from(entries['Viewer Demo/Front/assets/mesh.bin']!)).toEqual(
    Buffer.from([0, 1, 127, 255]),
  );
  expect(Buffer.from(entries['Viewer Demo/Rear/index.html']!).toString()).toBe(
    '<title>Rear</title>',
  );
  expect(result.tools).toEqual(['Front', 'Rear']);
  expect(result.size).toBe(bytes.length);
  expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(await readFile(result.checksum, 'utf8')).toBe(`${result.sha256}  Viewer-Demo.zip\n`);
  expect(
    await readFile(path.join(result.staging, 'Viewer Demo', 'Front', 'index.html'), 'utf8'),
  ).toBe('<title>Front</title>');
  expect(
    (await lstat(path.join(result.staging, 'Viewer Demo', 'Front', 'runtime', 'tool.js'))).mode &
      0o777,
  ).toBe(0o755);
  expect((await readdir(source, { recursive: true })).sort()).toEqual(originalNames);
  if (process.platform === 'darwin')
    expect(
      (await exec('/usr/bin/xattr', ['-p', 'com.viewer.demo-test', executable])).stdout.trim(),
    ).toBe('Generated owner metadata');
  expect(print.mock.calls.map(([message]) => message)).toEqual([
    `Staging folder kept: ${result.staging}`,
    `Archive: ${result.archive}`,
    `Size: ${result.size} bytes`,
    `SHA-256: ${result.sha256}`,
    'Saved tools: Front, Rear',
  ]);
});

it.each([[], ['one'], ['one', 'two', 'three']])(
  'refuses an argument count of %j',
  async (...args) => {
    await expect(demoArchiveCommand(args, vi.fn())).rejects.toThrow(
      'Give the absolute source folder and the absolute output folder.',
    );
  },
);

it.each(['source', 'output'])(
  'refuses a relative %s path before creating output',
  async (relative) => {
    const { source, output } = await fixture();
    await expect(
      demoArchiveCommand(
        [relative === 'source' ? 'saved-tools' : source, relative === 'output' ? 'output' : output],
        vi.fn(),
      ),
    ).rejects.toThrow('The source and output paths must be absolute.');
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(['file', 'missing'])('refuses a %s source', async (kind) => {
  const { root, output } = await fixture();
  const source = path.join(root, kind);
  if (kind === 'file') await writeFile(source, 'Keep this file.');
  await expect(demoArchiveCommand([source, output], vi.fn())).rejects.toThrow(
    'The source must be a folder.',
  );
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  'root',
  'root-trailing-slash',
  'file',
  'directory',
  'hidden',
  'hidden-directory',
  'dangling',
])('refuses a %s symbolic link without creating output', async (kind) => {
  const { root, source, output } = await fixture();
  let requested = source;
  if (kind === 'root' || kind === 'root-trailing-slash') {
    requested = path.join(root, 'source-link');
    await symlink(source, requested);
    if (kind === 'root-trailing-slash') requested += path.sep;
  } else {
    const folder =
      kind === 'hidden-directory'
        ? path.join(source, '.private')
        : path.join(source, 'Front', 'assets');
    await mkdir(folder, { recursive: true });
    const target =
      kind === 'directory' ? path.join(source, 'Rear') : path.join(source, 'Rear', 'index.html');
    await symlink(
      kind === 'dangling' ? path.join(root, 'missing') : target,
      path.join(folder, kind === 'hidden' ? '.link' : 'link'),
    );
  }
  await expect(demoArchiveCommand([requested, output], vi.fn())).rejects.toThrow(
    'The source must not contain symbolic links.',
  );
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses special source entries', async () => {
  const { source, output } = await fixture();
  await exec('/usr/bin/mkfifo', [path.join(source, 'pipe')]);
  await expect(demoArchiveCommand([source, output], vi.fn())).rejects.toThrow(
    'The source must contain only regular files and folders.',
  );
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses a source without a visible saved tool', async () => {
  const { root, output } = await fixture();
  const source = path.join(root, 'no-tools');
  await mkdir(path.join(source, '.hidden-tool'), { recursive: true });
  await writeFile(path.join(source, '.hidden-tool', 'canvas.viewer.json'), '{}');
  await writeFile(path.join(source, 'index.html'), '<title>No saved tool</title>');
  await expect(demoArchiveCommand([source, output], vi.fn())).rejects.toThrow(
    'The source must contain a saved tool with canvas.viewer.json.',
  );
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['Viewer-Demo.zip', 'Viewer-Demo.sha256'])(
  'refuses an existing %s without overwriting it',
  async (name) => {
    const { source, output } = await fixture();
    await mkdir(output);
    await writeFile(path.join(output, name), 'Keep the old output.');
    await expect(demoArchiveCommand([source, output], vi.fn())).rejects.toThrow(
      `The output folder already holds ${name}. Move it away first.`,
    );
    expect(await readFile(path.join(output, name), 'utf8')).toBe('Keep the old output.');
    expect(await readdir(output)).toEqual([name]);
  },
);

it.each(['same', 'nested', 'alias'])('refuses an output %s to the source', async (kind) => {
  const { root, source } = await fixture();
  let output = kind === 'same' ? source : path.join(source, 'not-created', 'output');
  if (kind === 'alias') {
    const alias = path.join(root, 'alias');
    await symlink(source, alias);
    output = path.join(alias, 'not-created', 'output');
  }
  await expect(demoArchiveCommand([source, output], vi.fn())).rejects.toThrow(
    'Choose an output folder outside the source folder.',
  );
  await expect(lstat(path.join(source, 'not-created'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('runs the script with source and output paths containing spaces', async () => {
  const { source, output } = await fixture();
  const { stdout, stderr } = await exec(process.execPath, [
    '--import',
    'tsx',
    'tools/demo-archive.ts',
    source,
    output,
  ]);
  expect(stderr).toBe('');
  expect(stdout).toContain('Saved tools: Front, Rear\n');
  expect(stdout).toMatch(/Size: \d+ bytes\nSHA-256: [a-f0-9]{64}\n/);
  expect(Object.keys(unzipSync(await readFile(path.join(output, 'Viewer-Demo.zip'))))).toContain(
    'Viewer Demo/Front/canvas.viewer.json',
  );
});
