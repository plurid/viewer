/** One universal WebAssembly build for macOS, Windows and Linux. Mutable upstream
 * URLs are accepted only with these decoded-byte hashes; drift requires review. */
export const officeEngineName = 'viewer-office-v1';
export const officeRuntimeName = 'viewer-office-v2';
export const officeRuntimeVersion =
  'ZetaOffice 24.2 / efaf0670b4d055f838a2849becb10f08aa06a257 / Noto CJK 2.004';
export const officeEngineFiles = [
  ['soffice.js', 858124, '5143e5354f470b87f86ba272bcfef857bd13e6f07b59666e48a7ccb89643cd77'],
  ['soffice.wasm', 161667499, '9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36846433474a5bd4'],
  ['soffice.data', 99520604, '3dab0a5448e599dccc1b1e69f4f86ea9eb30777c3f1ed7b9c386a5f4163e361c'],
  [
    'soffice.data.js.metadata',
    215180,
    '5d9d909d0b9b38443c0f19704032d0fc12d654f6c9c24c2c3b237739c4848ae3',
  ],
  ['zeta.js', 42946, 'b70ee7022908822c512535bbf43c4e44c297acc364e7542abba0d3071f5f9bfd'],
  ['zetaHelper.js', 9207, 'c07abdbc0d210ac803823d002520fac20d34ff18f20cbd5a78d203b5c9901a96'],
] as const;
export type OfficeAssetPin = readonly [name: string, bytes: number, sha256: string];
// The engine files stay byte-for-byte upstream. Only the RAM filesystem package
// gains the unmodified font collection before the engine initializes fontconfig.
export const officeRuntimeFiles: readonly OfficeAssetPin[] = officeEngineFiles.map((pin) => {
  if (pin[0] === 'soffice.data')
    return [pin[0], 119005388, '9b5dfdd6dc58e84756194a55d17fd9cb12c720c7d444c1c1913b23f7d205f738'];
  if (pin[0] === 'soffice.data.js.metadata')
    return [pin[0], 215283, '7e56861b78b0725bc7e9681dd5279ecf3f7449abba3712f1aa1c4a6dc891c773'];
  return pin;
});
export const officeInputLimit = 64 * 1024 * 1024;
export const officeOutputLimit = 32 * 1024 * 1024;
