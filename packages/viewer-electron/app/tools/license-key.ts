import type { KeyObject } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseLimits, licensePayloadSchema } from '../src/domain/license/license';
import type { LicensePayload } from '../src/domain/license/license';
import { licenseConfiguration } from '../src/desktop/release';
import type { LicenseConfiguration } from '../src/desktop/release';
import { feedPublicKey } from '../src/desktop/updates/signature';
import { licenseEndpoint, readLicenseKey } from '../src/desktop/license/signature';
import { createSigningKeys, signBytes, signingKey } from './update-feed';

const purchaseEmail = /^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+$/u;

export function issueLicenseKey(
  payload: LicensePayload,
  key: KeyObject,
  configuration: LicenseConfiguration = licenseConfiguration,
): string {
  const parsed = licensePayloadSchema.safeParse(payload);
  if (!parsed.success || !purchaseEmail.test(parsed.data.email))
    throw new Error('Give a purchase email, an order reference and a valid issue date.');
  const endpoint = licenseEndpoint(configuration);
  if (!endpoint)
    throw new Error('Set the license public key in src/desktop/release.ts before issuing keys.');
  const bytes = Buffer.from(JSON.stringify(parsed.data), 'utf8');
  const signature = signBytes(bytes, key).toString('base64url');
  const text = `viewer-license-1.${bytes.toString('base64url')}.${signature}`;
  if (text.length > licenseLimits.key) throw new Error('The license key exceeds its size limit.');
  try {
    readLicenseKey(text, endpoint.key);
  } catch {
    throw new Error('The signing key does not match the embedded license public key.');
  }
  return text;
}

export async function licenseKeyCommand(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  configuration: LicenseConfiguration = licenseConfiguration,
  now = new Date(),
): Promise<string> {
  const [command, first, second] = args;
  if (command === 'keys' && first && args.length === 2) {
    const publicKey = await createSigningKeys(first, 'VIEWER_LICENSE_SIGNING_KEY');
    return `Public key for licenseConfiguration in src/desktop/release.ts:\n${publicKey}`;
  }
  if (command === 'issue' && first && second && args.length === 3) {
    licenseEndpoint(configuration);
    return issueLicenseKey(
      { product: 'viewer', email: first, order: second, issued: now.toISOString().slice(0, 10) },
      await signingKey(env, 'VIEWER_LICENSE_SIGNING_KEY'),
      configuration,
    );
  }
  if (command === 'verify' && first && args.length === 2) {
    if (!configuration.publicKey)
      throw new Error('This build has no license public key configured.');
    const payload = readLicenseKey(
      first,
      feedPublicKey(configuration.publicKey, 'license public key'),
    );
    return `Licensed to ${payload.email}\nOrder: ${payload.order}\nIssued: ${payload.issued}`;
  }
  throw new Error(
    'Usage: tools/license-key.ts keys <absolute private key path> | issue <email> <order> | verify <key>',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await licenseKeyCommand(process.argv.slice(2)).then(
    (output) => console.log(output),
    (error: unknown) => {
      console.log(error instanceof Error ? error.message : 'The license command failed.');
      process.exitCode = 1;
    },
  );
