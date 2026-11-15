import { shell } from 'electron';
import path from 'node:path';
import { browserAddress } from '../../domain/previews/browser';
import type { LicenseStatus } from '../../domain/license/license';
import { licenseConfiguration } from '../release';
import { License } from './license';

async function openPurchase(url: string): Promise<void> {
  const address = new URL(browserAddress(url));
  if (address.protocol !== 'https:')
    throw new Error('Viewer opens its purchase page only from an https address.');
  await shell.openExternal(address.href);
}

export function applicationLicense(
  dataPath: string,
  changed: (status: LicenseStatus) => void,
): License {
  return new License(path.join(dataPath, 'license-v1.json'), {
    configuration: licenseConfiguration,
    store: !!process.mas,
    open: openPurchase,
    changed,
  });
}
