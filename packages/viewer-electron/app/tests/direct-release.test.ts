import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { notarizeRetained } from '../tools/direct-release';
import { temporaryRoot } from '../tools/temporary';

async function fixture() {
  const directory = await temporaryRoot('viewer-notarization-');
  const artifact = path.join(directory, 'Generated signed app.zip');
  const record = path.join(directory, 'notarization.json');
  await writeFile(artifact, 'Generated archive bytes to retain.\n');
  return { artifact, record };
}

describe('retained release submissions', () => {
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
