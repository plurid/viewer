import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { previewModules } from '../src/renderer/previews/registry';
import { localSamples, remoteSamples } from '../tools/playground/catalog';
import { downloadSample } from '../tools/playground/camera-raw';
import { maximumSampleBytes, openPlayground, sha256 } from '../tools/playground/files';
import { generatePlayground } from '../tools/playground/generate';
import { defaultPlaygroundDirectory, parseArguments } from '../tools/playground/main';
import { temporaryRoot } from '../tools/temporary';

const root = () => temporaryRoot('viewer-playground-test-');
const git = (directory: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: directory,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
      ),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
    encoding: 'utf8',
  }).trim();

describe('stable Viewer playground', () => {
  it('has a genuine recipe for every declared extension and conventional filename', async () => {
    const samples = [...(await localSamples()), ...remoteSamples];
    const paths = samples.map((sample) => sample.path);
    expect(new Set(paths).size).toBe(paths.length);
    const supplied = new Set(samples.flatMap((sample) => sample.formats));
    const declared = new Set(previewModules.flatMap((module) => module.formats));
    expect([...declared].filter((format) => !supplied.has(format))).toEqual([]);
    for (const sample of samples) {
      for (const format of sample.formats)
        expect(sample.path.toLowerCase().endsWith(`.${format}`)).toBe(true);
      expect(sample.description.length).toBeGreaterThan(0);
      expect(sample.source.length).toBeGreaterThan(0);
      expect(sample.license.length).toBeGreaterThan(0);
    }
    expect(samples.some((sample) => sample.path.endsWith('/.env.local'))).toBe(true);
    expect(samples.some((sample) => sample.path.endsWith('/Dockerfile'))).toBe(true);
    expect(samples.some((sample) => sample.path.endsWith('/.zshrc'))).toBe(true);
  });

  it('keeps the default beside the repository and rejects ambiguous CLI arguments', () => {
    expect(defaultPlaygroundDirectory).toBe(
      path.resolve(import.meta.dirname, '../../../../../viewer-playground'),
    );
    expect(parseArguments([])).toEqual({
      directory: defaultPlaygroundDirectory,
      downloadSamples: true,
    });
    expect(parseArguments(['--offline', '--directory', '/private/tmp/example'])).toEqual({
      directory: '/private/tmp/example',
      downloadSamples: false,
    });
    expect(parseArguments(['--help'])).toBe('help');
    expect(() => parseArguments(['--directory', 'relative'])).toThrow('absolute');
    expect(() => parseArguments(['--reset'])).toThrow('Unknown');
    expect(() => parseArguments(['--directory', '/a', '--directory', '/b'])).toThrow();
  });

  it('preserves unrelated destinations, links, changed samples and traversal boundaries', async () => {
    const parent = await root();
    const unrelated = path.join(parent, 'unrelated');
    await mkdir(unrelated);
    await writeFile(path.join(unrelated, 'Keep.txt'), 'user data');
    await expect(openPlayground(unrelated)).rejects.toThrow('no recognized');
    expect(await readFile(path.join(unrelated, 'Keep.txt'), 'utf8')).toBe('user data');
    const destination = path.join(parent, 'playground');
    const files = await openPlayground(destination);
    expect((await files.put('notes/Keep.txt', 'reference')).state).toBe('created');
    const before = await stat(path.join(destination, 'notes/Keep.txt'));
    expect((await files.put('notes/Keep.txt', 'reference')).state).toBe('unchanged');
    expect((await stat(path.join(destination, 'notes/Keep.txt'))).mtimeMs).toBe(before.mtimeMs);
    await writeFile(path.join(destination, 'notes/Keep.txt'), 'edited');
    expect((await files.put('notes/Keep.txt', 'reference')).state).toBe('modified');
    expect(await readFile(path.join(destination, 'notes/Keep.txt'), 'utf8')).toBe('edited');
    for (const name of ['../escaped.txt', '/absolute.txt', 'notes/../escaped.txt', 'a\\b.txt'])
      await expect(files.put(name, 'blocked')).rejects.toThrow('Invalid');
    await symlink(unrelated, path.join(destination, 'linked'));
    await expect(files.put('linked/Keep.txt', 'blocked')).rejects.toThrow('linked');
    await symlink(path.join(unrelated, 'Keep.txt'), path.join(destination, 'linked-file.txt'));
    await expect(files.put('linked-file.txt', 'blocked')).rejects.toThrow();
    await symlink(destination, path.join(parent, 'linked-root'));
    await expect(openPlayground(path.join(parent, 'linked-root'))).rejects.toThrow('ordinary');
    expect(await readFile(path.join(unrelated, 'Keep.txt'), 'utf8')).toBe('user data');
  });

  it('bounds downloads, verifies bytes and rejects corrupt or oversized responses before publication', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sample = { ...remoteSamples[0], size: bytes.length, sha256: sha256(bytes) };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes));
    expect(await downloadSample(sample, fetcher)).toEqual(bytes);
    await expect(downloadSample({ ...sample, sha256: '0'.repeat(64) }, fetcher)).rejects.toThrow(
      'checksum',
    );
    await expect(downloadSample({ ...sample, size: 3 }, fetcher)).rejects.toThrow('exceeded');
    await expect(downloadSample({ ...sample, size: 5 }, fetcher)).rejects.toThrow('incomplete');
    const calls = fetcher.mock.calls.length;
    await expect(
      downloadSample({ ...sample, size: maximumSampleBytes + 1 }, fetcher),
    ).rejects.toThrow('Invalid');
    expect(fetcher).toHaveBeenCalledTimes(calls);
    const wrongLength = vi.fn<typeof fetch>(
      async () => new Response(bytes, { headers: { 'content-length': '100' } }),
    );
    await expect(downloadSample(sample, wrongLength)).rejects.toThrow('Unexpected');
    const decodedTransfer = vi.fn<typeof fetch>(
      async () =>
        new Response(bytes, { headers: { 'content-length': '2', 'content-encoding': 'gzip' } }),
    );
    expect(await downloadSample(sample, decodedTransfer)).toEqual(bytes);
    await expect(
      downloadSample({ ...sample, sha256: '0'.repeat(64) }, decodedTransfer),
    ).rejects.toThrow('checksum');
  });

  it('preserves an interrupted Git initialization instead of replaying mutations', async () => {
    const parent = await root();
    const directory = path.join(parent, 'playground');
    const files = await openPlayground(directory);
    await files.reserveDirectory('git');
    await files.put('git/Keep.txt', 'Existing partial scenario.\n');
    const { report } = await generatePlayground({ directory, downloadSamples: false });
    expect(report.git).toMatchObject({ state: 'preserved', ready: false });
    expect(await readFile(path.join(directory, 'git/Keep.txt'), 'utf8')).toBe(
      'Existing partial scenario.\n',
    );
    await expect(readFile(path.join(directory, 'git/main/.git/config'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('creates real isolated Git scenarios once and preserves later edits, commits and staging', async () => {
    const parent = await root();
    const directory = path.join(parent, 'playground');
    const first = await generatePlayground({ directory, downloadSamples: false });
    expect(first.report.git.state).toBe('created');
    // offline, only the downloaded references are missing
    expect(first.report.coverage.missing.sort()).toEqual([
      'arw',
      'cr2',
      'cr3',
      'dng',
      'doc',
      'dot',
      'nef',
      'ogv',
      'orf',
      'otf',
      'pot',
      'pps',
      'ppt',
      'pptx',
      'raf',
      'rw2',
      'ttf',
      'woff',
      'woff2',
      'xls',
      'xlt',
    ]);
    const main = path.join(directory, 'git/main');
    const feature = path.join(directory, 'git/feature-worktree');
    const review = path.join(directory, 'git/review-worktree');
    const conflict = path.join(directory, 'git/conflict-worktree');
    expect(git(main, ['status', '--porcelain'])).toBe('');
    expect(git(review, ['status', '--porcelain'])).toBe('');
    const status = git(feature, ['status', '--porcelain']);
    expect(status).toContain('A  added.txt');
    expect(status).toContain('D  deleted.txt');
    expect(status).toContain(' M index.html');
    expect(status).toContain(' M modified.txt');
    expect(status).toContain('M  staged.txt');
    expect(status).toContain('?? untracked.txt');
    expect(git(feature, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).toBe(
      '1\t1',
    );
    expect(git(conflict, ['status', '--porcelain'])).toContain('UU conflict.txt');
    expect(git(main, ['worktree', 'list', '--porcelain'])).toContain('refs/heads/review');

    const reference = path.join(directory, 'previews/code-and-data/Example.ts');
    await writeFile(reference, '// User experiment\n');
    await writeFile(path.join(feature, 'user.txt'), 'Keep my branch work.\n');
    git(feature, ['add', '--', 'user.txt']);
    git(feature, ['commit', '-m', 'User playground experiment']);
    const mainRef = git(main, ['rev-parse', 'HEAD']);
    const featureRef = git(feature, ['rev-parse', 'HEAD']);
    const indexPath = path.resolve(feature, git(feature, ['rev-parse', '--git-path', 'index']));
    const index = await readFile(indexPath);
    const indexInfo = await stat(indexPath);
    const manifestBefore = await stat(path.join(directory, 'manifest.json'));
    const second = await generatePlayground({ directory, downloadSamples: false });
    expect(second.report.git.state).toBe('preserved');
    expect(second.report.files.find((file) => file.path.endsWith('Example.ts'))?.state).toBe(
      'modified',
    );
    expect(second.reportPath).not.toBe(first.reportPath);
    expect(await readFile(reference, 'utf8')).toBe('// User experiment\n');
    expect(git(main, ['rev-parse', 'HEAD'])).toBe(mainRef);
    expect(git(feature, ['rev-parse', 'HEAD'])).toBe(featureRef);
    expect(await readFile(indexPath)).toEqual(index);
    expect((await stat(indexPath)).mtimeMs).toBe(indexInfo.mtimeMs);
    expect((await stat(path.join(directory, 'manifest.json'))).mtimeMs).toBe(
      manifestBefore.mtimeMs,
    );
    expect(await readFile(path.join(feature, 'user.txt'), 'utf8')).toContain(
      'Keep my branch work.',
    );
  }, 30_000);
});
