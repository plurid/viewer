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

// Further makers' formats, as raw.pixls.us serves its CC0 originals, with their published SHA-256.
const pixls = 'https://raw.pixls.us/getfile.php/';
const pixlsRecords = [
  [
    'Nikon-COOLPIX-P1000.NRW',
    '3381/nice/Nikon%20-%20COOLPIX%20P1000%20-%2012bit%2012bit%20uncompressed%20%284:3%29.NRW',
    26472704,
    '1d9470ee083f914e51aa0be782161b432f27f87dbef551a59ec435f5dbc289dd',
  ],
  [
    'Samsung-NX500.SRW',
    '3668/nice/Samsung%20-%20NX500%20-%2012bit%2012bit%20normal%20compression%20%283:2%29.SRW',
    20750652,
    '156e43118811bcecb6fcc600b5f41ee1773c4f00b6a5b2dd72e177e35f6596ab',
  ],
  [
    'Pentax-K10D.PEF',
    '2239/nice/Pentax%20-%20K10D%20-%2012bit%2012bit%20compressed%20%283:2%29.PEF',
    9561139,
    'e35ae4154a468be3154f5f462e884ba5941f010d3e8f23d347fbec14809f44d3',
  ],
  [
    'Leica-D-LUX-5.RWL',
    '2811/nice/Leica%20-%20D-LUX%205%20-%201:1.RWL',
    10355200,
    'ceeb5e5bf2358c04706e807bc023971e085d969b6f36491a57ecff051a05e8d3',
  ],
  [
    'Hasselblad-H3D.3FR',
    '2851/nice/Hasselblad%20-%20H3D%20-%2016bit%20%284:3%29.3FR',
    53594112,
    '34fdb93cb215e4f419ae0f7252c57b881fa381003124b4f9c143d27741f211b3',
  ],
  [
    'Phase-One-P65-Plus.IIQ',
    '2767/nice/Phase%20One%20-%20P65%2B%20-%20IIQ%20S%20%284:3%29.IIQ',
    11591029,
    '69fc81e92360a45920158f7d6238eed0cd6260cd32aa4a0beec2ac79273add80',
  ],
  [
    'Epson-R-D1.ERF',
    '2680/nice/Epson%20-%20R-D1%20-%2012bit%20%283:2%29.ERF',
    9958994,
    '09d8e533d93116294a9f3e161ed868e929454c7b946e083b644bd6bb75bcb5e4',
  ],
  [
    'Minolta-DiMAGE-5.MRW',
    '7795/nice/Minolta%20-%20DiMAGE%205%20-%204:3.MRW',
    6422144,
    'd60bfd80bcb1f7b9c88b14a5e46ea27885bbf92d990ab30b3939288678fea0d9',
  ],
  [
    'Kodak-P712.KDC',
    '2345/nice/Kodak%20-%20KODAK%20P712%20ZOOM%20DIGITAL%20CAMERA%20-%20NAN.KDC',
    12245402,
    'b1c3870c8c794f0271053a80a15296e3a9b575ab736796cdb53929d50c86a084',
  ],
  [
    'Kodak-DCS760C.DCR',
    '1347/nice/Kodak%20-%20DCS760C%20-%2012bit%20%283:2%29.DCR',
    7547392,
    'd0e6bd0a3339daff884e73a08fed8e75b20fe05bba438fc185e3f0bd019d0da8',
  ],
  [
    'Sony-DSC-F828.SRF',
    '1351/nice/Sony%20-%20DSC-F828%20-%204:3.SRF',
    17393344,
    '07739f94bcab0c7e198d418ac65172d0dce04bb84a7683ecffd0bfe4b32f6d79',
  ],
  [
    'Sony-DSC-R1.SR2',
    '3221/nice/Sony%20-%20DSC-R1%20-%2014bit%2014bit%20uncompressed%20%283:2%29.SR2',
    21035488,
    '921c5f2513dd1671a9089e73fc778fc3573bc4cb70a3a555d0414661d0e62274',
  ],
  [
    'Leaf-Aptus-22.MOS',
    '3196/nice/Leaf%20-%20Aptus%2022%20-%2016bit%20%284:3%29.mos',
    23423633,
    '8a1a101cb3940b0648af54a721d92e6fb8612dd29a0909036ea2753196a00ec2',
  ],
] as const;

/** One original for each camera RAW kind beyond the eight above; Show as does not name these. */
export const moreCameraRawSamples: RemoteSample[] = pixlsRecords.map(
  ([name, file, size, sha256]) => ({
    path: `previews/images/camera-raw/${name}`,
    formats: [name.split('.').at(-1)!.toLowerCase()],
    preview: 'The embedded camera image, or a half-size RAW rendition, from the LibRaw helper.',
    description: 'Original camera RAW. Public sample from raw.pixls.us, unmodified.',
    source: 'https://raw.pixls.us/',
    license: 'CC0-1.0',
    url: pixls + file,
    sha256,
    size,
  }),
);

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
