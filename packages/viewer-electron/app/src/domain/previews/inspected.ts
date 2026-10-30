import type { KeyFile } from './keys/certificates';
import type { ProvisionFacts } from './data/provision';
import type { TorrentFacts } from './data/torrent';
import { certificateFormats, keyFormats, keyLimits, privateKeyNames } from './keys/certificates';
import { provisionFormats, provisionLimits } from './data/provision';
import { torrentLimits } from './data/torrent';

/**
 * Files the desktop service reads in its preview worker and describes field by field:
 * certificates and keys, torrents and provisioning profiles. The document read carries the result.
 */
export type InspectedFile = KeyFile | TorrentFacts | ProvisionFacts;
export type InspectedKind = InspectedFile['kind'];

const formats: readonly string[] = [...certificateFormats, ...keyFormats];
export function inspectedKind(extension: string, name: string): InspectedKind | undefined {
  const format = extension.toLowerCase();
  if (formats.includes(format) || (privateKeyNames as readonly string[]).includes(name))
    return 'keys';
  if (format === 'torrent') return 'torrent';
  if ((provisionFormats as readonly string[]).includes(format)) return 'provision';
  return undefined;
}
/** The bytes each kind is read up to. */
export const inspectedLimits: Readonly<Record<InspectedKind, number>> = {
  keys: keyLimits.bytes,
  torrent: torrentLimits.bytes,
  provision: provisionLimits.bytes,
};
