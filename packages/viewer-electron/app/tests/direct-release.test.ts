import { generateKeyPairSync } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { feedPublicKey, readSignedFeed } from '../src/desktop/updates/signature';
import {
  notarizeRetained,
  releaseGates,
  releaseSource,
  stapleApplicationRetained,
  versionNotes,
} from '../tools/direct-release';
import { temporaryRoot } from '../tools/temporary';
import {
  createSigningKeys,
  releaseFeedEndpoint,
  releaseNotes,
  signingKey,
  writeSignedFeed,
} from '../tools/update-feed';

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

const commit = 'a'.repeat(40);
function git(answers: Record<string, string>) {
  return vi.fn(async (args: string[]) => answers[args.join(' ')] ?? '');
}
const committed = {
  'status --porcelain --untracked-files=normal': '',
  'rev-parse --is-shallow-repository': 'false\n',
  'rev-parse HEAD': commit + '\n',
  'rev-list --count HEAD': '812\n',
};

describe('release gates', () => {
  it('names the commit and its build number from a clean, complete checkout', async () => {
    await expect(releaseSource(git(committed))).resolves.toEqual({ commit, build: '812' });
  });

  it('refuses a dirty tree, untracked files included, and a shallow clone', async () => {
    await expect(
      releaseSource(
        git({ ...committed, 'status --porcelain --untracked-files=normal': '?? generated.ts\n' }),
      ),
    ).rejects.toThrow('clean tree');
    await expect(
      releaseSource(git({ ...committed, 'rev-parse --is-shallow-repository': 'true\n' })),
    ).rejects.toThrow('full Git history');
  });

  it('checks, lints, formats, tests and checks the docs and Plurid packages before packaging', () => {
    expect(releaseGates).toEqual([
      'check',
      'lint',
      'format:check',
      'test',
      'docs:check',
      'plurid:check',
    ]);
  });

  it('refuses empty release notes and leaves out guidance lines', () => {
    expect(() => releaseNotes('# Guidance only\n\n# More guidance\n')).toThrow(
      'Write the release notes',
    );
    expect(releaseNotes('# Guidance\nFaster folders.\n\nNew previews.\n')).toBe(
      'Faster folders.\n\nNew previews.',
    );
    expect(() => releaseNotes('x'.repeat(4001))).toThrow('at most 4000');
  });

  it('ships the committed 1.0.0 notes only once they are written', async () => {
    const text = await readFile(path.resolve('release-notes/1.0.0.txt'), 'utf8');
    if (!text.split('\n').some((line) => line.trim() && !line.trim().startsWith('#')))
      await expect(versionNotes('1.0.0')).rejects.toThrow('Write the release notes');
    await expect(versionNotes('0.0.0-generated')).rejects.toThrow(
      'release-notes/0.0.0-generated.txt',
    );
  });
});

describe('the release feed', () => {
  const pair = () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      privateKey,
      pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    };
  };
  const url = 'https://updates.example.invalid/viewer/viewer-update.json';

  it('reads the signing key from the environment or an absolute file path only', async () => {
    const key = pair();
    const directory = await temporaryRoot('viewer-update-key-');
    const file = path.join(directory, 'generated-key.pem');
    await writeFile(file, key.pem);
    for (const env of [
      { VIEWER_UPDATE_SIGNING_KEY: key.pem },
      { VIEWER_UPDATE_SIGNING_KEY_FILE: file },
    ])
      expect((await signingKey(env)).asymmetricKeyType).toBe('ed25519');
    await expect(signingKey({})).rejects.toThrow('VIEWER_UPDATE_SIGNING_KEY_FILE');
    await expect(
      signingKey({ VIEWER_UPDATE_SIGNING_KEY: key.pem, VIEWER_UPDATE_SIGNING_KEY_FILE: file }),
    ).rejects.toThrow('not both');
    await expect(
      signingKey({ VIEWER_UPDATE_SIGNING_KEY_FILE: 'generated-key.pem' }),
    ).rejects.toThrow('absolute');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(
      signingKey({
        VIEWER_UPDATE_SIGNING_KEY: rsa.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }),
    ).rejects.toThrow('Ed25519');
  });

  it('refuses a release without a feed, or with a key the app would not accept', () => {
    const key = pair();
    expect(() => releaseFeedEndpoint(key.privateKey, { url: '', publicKey: '' })).toThrow(
      'before a release',
    );
    expect(() => releaseFeedEndpoint(key.privateKey, { url, publicKey: pair().publicKey })).toThrow(
      expect.objectContaining({ problem: 'signature' }),
    );
    expect(releaseFeedEndpoint(key.privateKey, { url, publicKey: key.publicKey }).feed.href).toBe(
      url,
    );
  });

  it('writes a feed and signature that the app reads, beside the checksums', async () => {
    const key = pair();
    const directory = await temporaryRoot('viewer-release-feed-');
    const feed = {
      version: '1.0.0',
      build: 812,
      notes: 'Generated notes.',
      url: 'https://updates.example.invalid/viewer/Viewer-1.0.0-812-arm64.dmg',
      sha256: 'b'.repeat(64),
      minimumSystemVersion: '14.0',
    };
    const files = await writeSignedFeed(directory, feed, key.privateKey);
    expect(path.basename(files.feed)).toBe('viewer-update.json');
    expect(path.basename(files.signature)).toBe('viewer-update.json.sig');
    expect(
      readSignedFeed(
        await readFile(files.feed),
        await readFile(files.signature, 'utf8'),
        feedPublicKey(key.publicKey),
      ),
    ).toEqual(feed);
    // a second release never overwrites the first one's files
    await expect(writeSignedFeed(directory, feed, key.privateKey)).rejects.toThrow();
  });

  it('makes a new private key file readable by its owner only', async () => {
    const directory = await temporaryRoot('viewer-update-keys-');
    const file = path.join(directory, 'generated-key.pem');
    const publicKey = await createSigningKeys(file);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(feedPublicKey(publicKey).asymmetricKeyType).toBe('ed25519');
    await expect(createSigningKeys(file)).rejects.toThrow();
    await expect(createSigningKeys('generated-key.pem')).rejects.toThrow('absolute');
  });
});
