/**
 * Thirteen more camera RAW kinds go through the bundled LibRaw helper, as CR2, NEF and ARW do. Each
 * public original renders its camera image and a RAW rendition where the playground holds it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileEntry } from '../src/domain/contracts';
import { fileFamily } from '../src/domain/files/entries';
import { cameraRawFormats } from '../src/domain/previews/images/rendered';
import { DerivedPreviews, rawDecoder } from '../src/desktop/previews/derived';
import { imageDimensions } from '../src/desktop/previews/image-dimensions';
import { choosePreview } from '../src/renderer/previews/registry';
import { moreCameraRawSamples } from '../tools/playground/camera-raw';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { holds, placePinned } from './support/real-corpus';

const helper = fileURLToPath(
  new URL(`../assets/viewer-raw-v3-darwin-${process.arch}/viewer-raw`, import.meta.url),
);
const kinds = [
  'nrw',
  'srw',
  'pef',
  'rwl',
  '3fr',
  'iiq',
  'erf',
  'mrw',
  'kdc',
  'dcr',
  'srf',
  'sr2',
  'mos',
];

describe('more camera RAW kinds', () => {
  it('opens each as a camera image, with one public original each', () => {
    expect(cameraRawFormats).toEqual(expect.arrayContaining(kinds));
    expect(moreCameraRawSamples.flatMap((sample) => sample.formats).toSorted()).toEqual(
      kinds.toSorted(),
    );
    for (const extension of kinds) {
      const entry = { name: 'Photo.' + extension, extension, mime: '' } as FileEntry;
      expect(choosePreview(entry).id, extension).toBe('rendered-image');
      expect(fileFamily(entry), extension).toBe('image');
    }
  });
});

const ready = process.platform === 'darwin' && existsSync(helper);
describe.skipIf(!ready)('the LibRaw helper', () => {
  let root: string;
  beforeAll(async () => {
    root = await temporaryRoot('viewer-camera-raw-');
  });
  afterAll(async () => {
    await trashTemporary(root);
  });
  for (const sample of moreCameraRawSamples) {
    const name = path.basename(sample.path);
    it.skipIf(!holds(sample))(`renders ${name}`, { timeout: 60000 }, async () => {
      const file = path.join(root, name);
      await placePinned(sample, file);
      const previews = new DerivedPreviews(async () => {}, rawDecoder(helper));
      try {
        for (const mode of ['camera', 'raw'] as const) {
          const lease = await previews.read(file, mode, new AbortController().signal);
          try {
            expect(lease.value.kind, mode).toBe(mode);
            const size = imageDimensions(lease.value.data);
            expect(Math.min(size?.width ?? 0, size?.height ?? 0), mode).toBeGreaterThan(100);
          } finally {
            lease.release();
          }
        }
      } finally {
        await previews.close();
      }
    });
  }
});
