/** The signed update feed's release side: a key pair, a signed feed, and a check of the published
 * one. The private key never enters the repository; release tooling reads it from the environment. */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedLimits, updateFeedSchema } from '../src/domain/updates/feed';
import type { UpdateFeed } from '../src/domain/updates/feed';
import { updateFeedConfiguration } from '../src/desktop/release';
import type { UpdateFeedConfiguration } from '../src/desktop/release';
import { feedEndpoint, readSignedFeed } from '../src/desktop/updates/signature';
import type { FeedEndpoint } from '../src/desktop/updates/signature';
import { fetchFeed } from '../src/desktop/updates/updates';
import { macOSMinimum } from './native-build/macos-target';

export const feedFile = 'viewer-update.json';

export type SigningKeyVariable = 'VIEWER_UPDATE_SIGNING_KEY' | 'VIEWER_LICENSE_SIGNING_KEY';

async function signingKeyPath(
  file: string,
  variable: SigningKeyVariable,
  creating = false,
): Promise<void> {
  if (!path.isAbsolute(file))
    throw new Error(
      creating
        ? 'The private key path argument must be absolute.'
        : `${variable}_FILE must be an absolute path.`,
    );
  if (variable !== 'VIEWER_LICENSE_SIGNING_KEY') return;
  const repository = await realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
  const resolved = creating
    ? path.join(await realpath(path.dirname(file)), path.basename(file))
    : await realpath(file);
  const relative = path.relative(repository, resolved);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)))
    throw new Error('Keep the license signing key outside the repository.');
}

/** The named environment variable holds PEM text; its `_FILE` counterpart holds an absolute path. */
export async function signingKey(
  env: NodeJS.ProcessEnv,
  variable: SigningKeyVariable = 'VIEWER_UPDATE_SIGNING_KEY',
): Promise<KeyObject> {
  const text = env[variable]?.trim();
  const file = env[variable + '_FILE']?.trim();
  const name = variable === 'VIEWER_LICENSE_SIGNING_KEY' ? 'license' : 'update';
  if (text && file) throw new Error(`Set ${variable} or ${variable}_FILE, not both.`);
  if (!text && !file)
    throw new Error(`Set ${variable}_FILE to the absolute path of the ${name} signing key.`);
  if (file) await signingKeyPath(file, variable);
  let key: KeyObject;
  try {
    key = createPrivateKey(text ?? (await readFile(file!, 'utf8')));
  } catch {
    throw new Error(`The ${name} signing key could not be read as a PEM private key.`);
  }
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error(`The ${name} signing key must be an Ed25519 key.`);
  return key;
}

export function signBytes(bytes: Uint8Array, key: KeyObject): Buffer {
  return sign(null, bytes, key);
}

/** The feed bytes and their base64 signature, as the app reads them. */
export function signFeed(feed: UpdateFeed, key: KeyObject): { bytes: Buffer; signature: string } {
  const bytes = Buffer.from(JSON.stringify(updateFeedSchema.parse(feed), null, 2) + '\n');
  if (bytes.byteLength > feedLimits.feed) throw new Error('The update feed is too large.');
  return { bytes, signature: signBytes(bytes, key).toString('base64') + '\n' };
}

/** Refuses a release whose feed this build could not read: no feed, or a key that does not
 * match the one embedded in the app. */
export function releaseFeedEndpoint(
  key: KeyObject,
  configuration: UpdateFeedConfiguration = updateFeedConfiguration,
): FeedEndpoint {
  const endpoint = feedEndpoint(configuration);
  if (!endpoint)
    throw new Error(
      'Set the update feed address and public key in src/desktop/release.ts before a release.',
    );
  const probe = signFeed(
    {
      version: '0.1.0-0',
      build: 1,
      notes: 'Key check.',
      url: endpoint.feed.href,
      sha256: '0'.repeat(64),
      minimumSystemVersion: macOSMinimum,
    },
    key,
  );
  readSignedFeed(probe.bytes, probe.signature, endpoint.key);
  return endpoint;
}

/** Lines starting with # guide the owner without appearing in the published feed. */
export function releaseNotes(text: string): string {
  const notes = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .trim();
  if (!notes) throw new Error('Write the release notes and commit them before shipping.');
  if (notes.length > feedLimits.notes)
    throw new Error(`Release notes must be at most ${feedLimits.notes} characters.`);
  return notes;
}

/** Writes the feed and its signature into `directory`; returns their paths. */
export async function writeSignedFeed(
  directory: string,
  feed: UpdateFeed,
  key: KeyObject,
): Promise<{ feed: string; signature: string }> {
  const signed = signFeed(feed, key);
  const files = {
    feed: path.join(directory, feedFile),
    signature: path.join(directory, feedFile + '.sig'),
  };
  await writeFile(files.feed, signed.bytes, { flag: 'wx' });
  await writeFile(files.signature, signed.signature, { flag: 'wx' });
  return files;
}

/** A new key pair. The private key file is new, readable by its owner only. */
export async function createSigningKeys(
  file: string,
  variable: SigningKeyVariable = 'VIEWER_UPDATE_SIGNING_KEY',
): Promise<string> {
  await signingKeyPath(file, variable, true);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await writeFile(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    flag: 'wx',
    mode: 0o600,
  });
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

async function main(command: string | undefined, argument: string | undefined) {
  if (command === 'keys') {
    if (!argument) throw new Error('Usage: pnpm updates:keys <absolute path for the private key>');
    const publicKey = await createSigningKeys(argument);
    console.log(
      `Private key written to ${argument}. Keep it outside the repository and back it up.\n` +
        `Public key for src/desktop/release.ts:\n${publicKey}`,
    );
    return;
  }
  if (command === 'verify') {
    const endpoint = feedEndpoint(updateFeedConfiguration);
    if (!endpoint) throw new Error('This build has no update feed configured.');
    const feed = await fetchFeed(endpoint, fetch);
    console.log(
      `${endpoint.feed.href} is signed by the embedded key: Viewer ${feed.version} (${feed.build}), ${feed.url}`,
    );
    return;
  }
  throw new Error('Usage: tools/update-feed.ts keys <private key path> | verify');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv[2], process.argv[3]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
