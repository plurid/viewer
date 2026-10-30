/**
 * Sound and video Viewer plays through Chromium where it can and through a complete compatibility
 * copy otherwise. Each playground sample goes through the bundled FFmpeg the app uses; the AMR and
 * Monkey's Audio references are read where the playground holds them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileEntry } from '../src/domain/contracts';
import { fileFamily } from '../src/domain/files/entries';
import { mediaDemuxer } from '../src/desktop/transforms/media';
import { Resources } from '../src/desktop/previews/resources';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import { videoDecoder } from '../src/desktop/previews/video-rendition';
import { choosePreview } from '../src/renderer/previews/registry';
import { audioReferenceSamples } from '../tools/playground/audio-references';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { holds, placePinned } from './support/real-corpus';

const assets = fileURLToPath(new URL('../tools/playground/assets/', import.meta.url));
const processors = fileURLToPath(
  new URL(`../assets/viewer-processors-${process.platform}-${process.arch}/`, import.meta.url),
);
const file = (extension: string, mime = 'application/octet-stream') =>
  ({ name: 'Sample.' + extension, extension, mime, directory: false }) as FileEntry;
/** Each new kind, its playground asset and what the copy holds. */
const samples: [extension: string, asset: string, copy: 'm4a' | 'mp4'][] = [
  ['oga', 'tone.oga', 'm4a'],
  ['au', 'tone.au', 'm4a'],
  ['snd', 'tone.snd', 'm4a'],
  ['mp2', 'tone.mp2', 'm4a'],
  ['mpa', 'tone.mp2', 'm4a'],
  ['m2v', 'motion.m2v', 'mp4'],
  ['f4v', 'motion.f4v', 'mp4'],
];

describe('more audio and video kinds', () => {
  it('opens each in the media preview, as sound or as video', () => {
    for (const [extension, mime, family] of [
      ['oga', 'audio/ogg', 'audio'],
      ['amr', 'audio/amr', 'audio'],
      ['ape', 'application/octet-stream', 'audio'],
      ['au', 'audio/basic', 'audio'],
      ['snd', 'audio/basic', 'audio'],
      ['mp2', 'audio/mpeg', 'audio'],
      ['mpa', 'application/octet-stream', 'audio'],
      ['m2v', 'video/mpeg', 'video'],
      ['f4v', 'video/x-f4v', 'video'],
    ] as const) {
      expect(choosePreview(file(extension, mime)).id, extension).toBe('media');
      expect(fileFamily(file(extension, mime)), extension).toBe(family);
      expect(mediaDemuxer(extension), extension).toBeTruthy();
    }
    // MPEG audio of any layer goes through one demuxer
    expect(mediaDemuxer('mp2')).toBe(mediaDemuxer('mpa'));
  });
});

const ready = process.platform === 'darwin' && existsSync(path.join(processors, 'ffmpeg'));
describe.skipIf(!ready)('compatibility copies with the bundled FFmpeg', () => {
  let root: string;
  let converting: Resources;
  beforeEach(async () => {
    root = await temporaryRoot('viewer-media-formats-');
    converting = new Resources(
      async () => {},
      undefined,
      12000,
      new DerivedPreviews(async () => {}, videoDecoder(processors)),
    );
  });
  afterEach(async () => {
    await converting.close();
    await trashTemporary(root);
  });
  const convert = async (name: string) => {
    const source = await converting.grant(path.join(root, name));
    return converting.videoRendition(source.id, name);
  };

  it('copies every generated sample through its last frame', { timeout: 120000 }, async () => {
    for (const [extension, asset, kind] of samples) {
      const name = `Sample.${extension}`;
      await copyFile(path.join(assets, asset), path.join(root, name));
      const copy = await convert(name);
      expect(copy.derivation?.kind, name).toBe('video');
      expect(copy.entry.extension, name).toBe(kind);
      expect(copy.entry.size, name).toBeGreaterThan(1000);
    }
  });

  it.skipIf(!audioReferenceSamples.every(holds))(
    "copies the AMR and Monkey's Audio references",
    { timeout: 120000 },
    async () => {
      for (const sample of audioReferenceSamples) {
        const name = path.basename(sample.path);
        await placePinned(sample, path.join(root, name));
        const copy = await convert(name);
        expect(copy.entry.extension, name).toBe('m4a');
        expect(copy.entry.size, name).toBeGreaterThan(1000);
      }
    },
  );
});
