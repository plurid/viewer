/** One universal WebAssembly build for macOS, Windows and Linux. Mutable upstream
 * URLs are accepted only with these decoded-byte hashes; drift requires review. */
export const officeEngineName = 'viewer-office-v1';
export const officeRuntimeName = 'viewer-office-v3';
export const officeRuntimeVersion =
  'ZetaOffice 24.2 / efaf0670b4d055f838a2849becb10f08aa06a257 / Noto Sans CJK 2.004, Serif CJK 2.001 / regional fallbacks 1';
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
// gains unmodified font collections and fallback aliases before fontconfig initializes.
export const officeRuntimeFiles: readonly OfficeAssetPin[] = officeEngineFiles.map((pin) => {
  if (pin[0] === 'soffice.data')
    return [pin[0], 145305851, '7469336539d09f4fd5a006119419014d5818d2f7d7cf0a9772d2dfda1dd1a6a2'];
  if (pin[0] === 'soffice.data.js.metadata')
    return [pin[0], 215488, 'cb53d4f56900f4b94a9b6ec394b8f88561368b94100a3ede7bdf2019db076f41'];
  return pin;
});
export const officeInputLimit = 64_000_000;
export const officeOutputLimit = 32_000_000;
