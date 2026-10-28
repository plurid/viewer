import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { notarizeRetained, stapleApplicationRetained } from '../tools/direct-release';
import { temporaryRoot } from '../tools/temporary';

async function fixture() {
  const directory = await temporaryRoot('viewer-notarization-');
  const artifact = path.join(directory, 'Generated signed app.zip');
  const record = path.join(directory, 'notarization.json');
  await writeFile(artifact, 'Generated archive bytes to retain.\n');
  return { artifact, record };
}

describe('retained release submissions', () => {
  it('staples and validates a retained short-path app copy without changing the signed source', async () => {
    const root = await temporaryRoot('viewer-staple-source-');
    const app = path.join(root, 'Generated.app');
    await mkdir(path.join(app, 'Contents'), { recursive: true });
    await writeFile(path.join(app, 'Contents', 'fixture.txt'), 'Generated signed-source stand-in');
    const run = vi.fn(async () => 'Generated successful Apple-tool result');
    const result = await stapleApplicationRetained(app, run);
    expect(path.basename(result)).toBe('Generated.app');
    expect(result).not.toBe(app);
    expect(run.mock.calls).toEqual([
      [['stapler', 'staple', result]],
      [['stapler', 'validate', result]],
    ]);
    for (const location of [app, result])
      expect(await readFile(path.join(location, 'Contents', 'fixture.txt'), 'utf8')).toBe(
        'Generated signed-source stand-in',
      );
  });

  it('retains both app copies when Apple stapling fails and does not attempt validation', async () => {
    const root = await temporaryRoot('viewer-staple-failed-');
    const app = path.join(root, 'Generated.app');
    await mkdir(app);
    const run = vi.fn(async (_args: string[]) => {
      throw new Error('Generated stapler failure');
    });
    await expect(stapleApplicationRetained(app, run)).rejects.toThrow('Generated stapler failure');
    expect(run).toHaveBeenCalledOnce();
    const result = run.mock.calls[0]![0].at(-1)!;
    expect((await lstat(app)).isDirectory()).toBe(true);
    expect((await lstat(result)).isDirectory()).toBe(true);
  });

  it('only validates an existing ticket instead of replacing it on a repeat', async () => {
    const root = await temporaryRoot('viewer-staple-existing-');
    const app = path.join(root, 'Generated.app');
    await mkdir(path.join(app, 'Contents'), { recursive: true });
    await writeFile(path.join(app, 'Contents', 'CodeResources'), 'Generated ticket stand-in');
    const run = vi.fn(async () => 'Generated successful validation');
    const result = await stapleApplicationRetained(app, run);
    expect(run).toHaveBeenCalledExactlyOnceWith(['stapler', 'validate', result]);
    expect(await readFile(path.join(result, 'Contents', 'CodeResources'), 'utf8')).toBe(
      'Generated ticket stand-in',
    );
  });

  it('submits a literal archive path and Keychain profile, retaining the accepted response', async () => {
    const { artifact, record } = await fixture();
    const response = JSON.stringify({ id: 'generated-submission', status: 'Accepted' });
    const run = vi.fn(async () => response);

    await expect(notarizeRetained(artifact, 'generated profile', record, run)).resolves.toEqual({
      id: 'generated-submission',
      status: 'Accepted',
    });
    expect(run).toHaveBeenCalledExactlyOnceWith([
      'notarytool',
      'submit',
      artifact,
      '--keychain-profile',
      'generated profile',
      '--wait',
      '--output-format',
      'json',
    ]);
    expect(await readFile(record, 'utf8')).toBe(response);
    expect(await readFile(artifact, 'utf8')).toBe('Generated archive bytes to retain.\n');
  });

  it('preserves rejected submissions and their archive for diagnosis instead of cleaning them up', async () => {
    const { artifact, record } = await fixture();
    const response = JSON.stringify({ id: 'generated-rejection', status: 'Invalid' });

    await expect(
      notarizeRetained(artifact, 'generated profile', record, async () => response),
    ).rejects.toThrow('Invalid (generated-rejection)');
    expect(await readFile(record, 'utf8')).toBe(response);
    expect(await readFile(artifact, 'utf8')).toBe('Generated archive bytes to retain.\n');
  });

  it.each(['not JSON', JSON.stringify({ id: 123, status: 'Accepted' })])(
    'retains an unexpected response without treating it as acceptance: %s',
    async (response) => {
      const { artifact, record } = await fixture();

      await expect(
        notarizeRetained(artifact, 'generated profile', record, async () => response),
      ).rejects.toThrow();
      expect(await readFile(record, 'utf8')).toBe(response);
      expect(await readFile(artifact, 'utf8')).toBe('Generated archive bytes to retain.\n');
    },
  );

  it('retains partial output when the notarization command fails', async () => {
    const { artifact, record } = await fixture();
    const failure = Object.assign(new Error('Generated command timeout'), {
      stdout: 'Generated partial submission output',
    });

    await expect(
      notarizeRetained(artifact, 'generated profile', record, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(JSON.parse(await readFile(record, 'utf8'))).toEqual({
      status: 'Command failed',
      error: 'Generated command timeout',
      stdout: 'Generated partial submission output',
    });
    expect(await readFile(artifact, 'utf8')).toBe('Generated archive bytes to retain.\n');
  });
});
