import { createPublicKey, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { feedLimits, updateFeedSchema } from '../../domain/updates/feed';
import type { UpdateFeed } from '../../domain/updates/feed';
import type { UpdateFeedConfiguration } from '../release';

export type UpdateProblem = 'network' | 'signature' | 'invalid';

export class UpdateError extends Error {
  constructor(
    readonly problem: UpdateProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface FeedEndpoint {
  feed: URL;
  signature: URL;
  key: KeyObject;
}

/** An https address without credentials, or an error naming the field. */
export function httpsAddress(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The ${name} is not a valid address.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error(`The ${name} must be an https address without credentials.`);
  return url;
}

/** The embedded key: base64 of an Ed25519 SubjectPublicKeyInfo. */
export function feedPublicKey(value: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new Error('The update public key is not a valid key.');
  }
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('The update public key must be an Ed25519 key.');
  return key;
}

/** Where this build reads its feed, or undefined when the build has none. */
export function feedEndpoint(configuration: UpdateFeedConfiguration): FeedEndpoint | undefined {
  if (!configuration.url && !configuration.publicKey) return undefined;
  if (!configuration.url || !configuration.publicKey)
    throw new Error('The update feed needs both its address and its public key.');
  const feed = httpsAddress(configuration.url, 'update feed address');
  const signature = new URL(feed);
  signature.pathname += '.sig';
  return { feed, signature, key: feedPublicKey(configuration.publicKey) };
}

/** Checks the signature over the exact bytes before reading any of them as JSON. */
export function readSignedFeed(feed: Uint8Array, signature: string, key: KeyObject): UpdateFeed {
  if (feed.byteLength > feedLimits.feed)
    throw new UpdateError('invalid', 'The update information is larger than Viewer accepts.');
  const text = signature.trim();
  const bytes = Buffer.from(text, 'base64');
  if (!/^[A-Za-z0-9+/]{86}==$/.test(text) || !verify(null, feed, key, bytes))
    throw new UpdateError(
      'signature',
      'The update information is not signed by the publisher of Viewer, so Viewer ignored it.',
    );
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(feed).toString('utf8'));
  } catch {
    throw new UpdateError('invalid', 'The update information could not be read.');
  }
  const parsed = updateFeedSchema.safeParse(value);
  if (!parsed.success)
    throw new UpdateError('invalid', 'The update information could not be read.');
  return parsed.data;
}
