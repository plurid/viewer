/** The signed update feed's release side: a key pair, a signed feed, and a check of the published
 * one. The private key never enters the repository; release tooling reads it from the environment. */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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

/** `VIEWER_UPDATE_SIGNING_KEY` holds the PEM text, or `VIEWER_UPDATE_SIGNING_KEY_FILE` its path. */
export async function signingKey(env: NodeJS.ProcessEnv): Promise<KeyObject> {
  const text = env.VIEWER_UPDATE_SIGNING_KEY?.trim();
  const file = env.VIEWER_UPDATE_SIGNING_KEY_FILE?.trim();
  if (text && file)
    throw new Error('Set VIEWER_UPDATE_SIGNING_KEY or VIEWER_UPDATE_SIGNING_KEY_FILE, not both.');
  if (!text && !file)
    throw new Error(
      'Set VIEWER_UPDATE_SIGNING_KEY_FILE to the absolute path of the update signing key (pnpm updates:keys makes one).',
    );
  if (file && !path.isAbsolute(file))
    throw new Error('VIEWER_UPDATE_SIGNING_KEY_FILE must be an absolute path.');
  let key: KeyObject;
  try {
    key = createPrivateKey(text ?? (await readFile(file!, 'utf8')));
  } catch {
    throw new Error('The update signing key could not be read as a PEM private key.');
  }
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('The update signing key must be an Ed25519 key.');
  return key;
}

/** The feed bytes and their base64 signature, as the app reads them. */
export function signFeed(feed: UpdateFeed, key: KeyObject): { bytes: Buffer; signature: string } {
  const bytes = Buffer.from(JSON.stringify(updateFeedSchema.parse(feed), null, 2) + '\n');
  if (bytes.byteLength > feedLimits.feed) throw new Error('The update feed is too large.');
  return { bytes, signature: sign(null, bytes, key).toString('base64') + '\n' };
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
      version: '0.0.1',
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

/** Release notes for one version: lines starting with # are guidance and left out. */
export function releaseNotes(text: string): string {
  const notes = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .trim();
  if (!notes) throw new Error('Write the release notes before shipping.');
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
export async function createSigningKeys(file: string): Promise<string> {
  if (!path.isAbsolute(file)) throw new Error('Give an absolute path for the private key.');
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
