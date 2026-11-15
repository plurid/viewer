import { verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { licenseKeyText, licenseLimits, licensePayloadSchema } from '../../domain/license/license';
import type { LicensePayload } from '../../domain/license/license';
import type { LicenseConfiguration } from '../release';
import { feedPublicKey, httpsAddress } from '../updates/signature';

export interface LicenseEndpoint {
  key: KeyObject;
  purchaseURL: URL;
}

/** Empty configuration is intentional; partial or mistyped publisher fields must stop a release. */
export function licenseEndpoint(configuration: LicenseConfiguration): LicenseEndpoint | undefined {
  if (!configuration.publicKey && !configuration.purchaseURL) return undefined;
  if (!configuration.publicKey)
    throw new Error('The licenseConfiguration.publicKey field needs an Ed25519 public key.');
  if (!configuration.purchaseURL)
    throw new Error('The licenseConfiguration.purchaseURL field needs an https purchase address.');
  const key = feedPublicKey(configuration.publicKey, 'licenseConfiguration.publicKey');
  if (key.export({ format: 'der', type: 'spki' }).toString('base64') !== configuration.publicKey)
    throw new Error(
      'The licenseConfiguration.publicKey field must be a base64 Ed25519 public key.',
    );
  return {
    key,
    purchaseURL: httpsAddress(configuration.purchaseURL, 'licenseConfiguration.purchaseURL'),
  };
}

export type LicenseProblem = 'format' | 'signature' | 'invalid';

export class LicenseError extends Error {
  constructor(
    readonly problem: LicenseProblem,
    message: string,
  ) {
    super(message);
  }
}

/** The payload is verified as received, before UTF-8 decoding or JSON normalization. */
export function readLicenseKey(text: string, key: KeyObject): LicensePayload {
  if (text.length > licenseLimits.key)
    throw new LicenseError('format', 'Paste the complete Viewer license key from your purchase.');
  const compact = licenseKeyText(text);
  const match = /^viewer-license-1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/.exec(compact);
  if (!match)
    throw new LicenseError('format', 'Paste the complete Viewer license key from your purchase.');
  const payload = Buffer.from(match[1]!, 'base64url');
  const signature = Buffer.from(match[2]!, 'base64url');
  if (payload.toString('base64url') !== match[1] || signature.toString('base64url') !== match[2])
    throw new LicenseError('format', 'Paste the complete Viewer license key from your purchase.');
  if (!verify(null, payload, key, signature))
    throw new LicenseError(
      'signature',
      'This license key was changed in transit or was not issued by Viewer. Copy it again from your purchase.',
    );
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch {
    throw new LicenseError('invalid', 'This is not a readable license key for Viewer.');
  }
  const parsed = licensePayloadSchema.safeParse(value);
  if (!parsed.success)
    throw new LicenseError('invalid', 'This is not a valid license key for Viewer.');
  return parsed.data;
}
