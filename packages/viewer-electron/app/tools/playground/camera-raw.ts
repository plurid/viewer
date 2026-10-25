import type { RemoteSample } from './types';
import { maximumSampleBytes, sha256 } from './files';

// Release v1, checked against its published SHA256SUMS.txt and asset sizes.
// The large, original files belong in the playground, never application Git history.
const release = 'https://github.com/tellodaniel/revelraw-sample-raw-files/releases/download/v1/';
const source = 'https://github.com/tellodaniel/revelraw-sample-raw-files/tree/main';
const records = [
  ['Sony-a7III.ARW', 25639680, '250784580ea527442c09004417bb0eead484f2bf3ee8f9121a776ac65bb50d0f'],
  ['Canon-EOS-R.CR3', 29045112, 'cfd118af4477ef37538eb953421572a7a5c80694e59764049223107cc0c9ae83'],
  [
    'Canon-5D-Mark-IV.CR2',
    33900585,
    '02b23f9cc6dc4c99fb39aa4d1f65ac227804d06461ac1bd0f842aa2f3beb8fe4',
  ],
  ['Nikon-Z6.NEF', 25994889, '8ca94584578b35a422744c1a610174ce37df0691588edfdecaec3111b3fbbb02'],
  [
    'Fujifilm-X-T4.RAF',
    26971008,
    '871836938ffa695f4c41765ddb107c2703ce755f7f3ced7e10f9e04746f1734e',
  ],
  [
    'Panasonic-G9.RW2',
    24272896,
    'cfb015a89d7af92306328868e6d87ac7974c427612608016821dfb336e8e3faa',
  ],
  [
    'OM-System-OM-1.ORF',
    21820729,
    'bf2eef6becc0851e48231617c3e2eac27a2cdb44c75b93035c561d837952c18b',
  ],
  [
    'Ricoh-GR-III.DNG',
    33374940,
    '05513ee72f7cac4165534c9f64995412084f414a033c80c473c79fd94154292e',
  ],
] as const;

export const cameraRawSamples: RemoteSample[] = records.map(([name, size, sha256]) => ({
  path: `previews/images/camera-raw/${name}`,
  formats: [name.split('.').at(-1)!.toLowerCase()],
  preview: 'System-rendered bitmap; camera and OS decoder dependent.',
  description:
    'Original camera RAW. Public sample from raw.pixls.us, mirrored byte-for-byte by RevelRaw.',
  source,
  license: 'CC0-1.0',
  url: release + name,
  sha256,
  size,
}));

export async function downloadSample(
  sample: RemoteSample,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(sample.size) || sample.size < 1 || sample.size > maximumSampleBytes)
    throw new Error(`Invalid sample size: ${sample.path}`);
  const response = await fetcher(sample.url, {
    signal: AbortSignal.timeout(120_000),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok || !response.body)
    throw new Error(`Sample download failed (${response.status}): ${sample.path}`);
  const declared = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding');
  // Fetch delivers decoded bytes; a compressed transfer length describes a
  // different representation. Actual byte count and SHA256 remain mandatory.
  if (declared && (!encoding || encoding === 'identity') && Number(declared) !== sample.size) {
    await response.body.cancel();
    throw new Error(`Unexpected sample download size: ${sample.path}`);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(sample.size);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > sample.size)
        throw new Error(`Sample download exceeded its pinned size: ${sample.path}`);
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== sample.size) throw new Error(`Sample download was incomplete: ${sample.path}`);
    if (sha256(bytes) !== sample.sha256)
      throw new Error(`Sample checksum mismatch: ${sample.path}`);
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
