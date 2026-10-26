import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeFile, open, type FileHandle, readFile } from 'node:fs/promises';
import path from 'node:path';
import { videoDecoder, videoPreviewLimit } from '../src/desktop/previews/video-rendition';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type { runProcessor } from '../src/desktop/transforms/process';
let root: string, file: string, handle: FileHandle;
beforeEach(async () => {
  root = await temporaryRoot('viewer-video-copy-');
  file = path.join(root, 'video.ogv');
  await writeFile(file, 'generated source');
  handle = await open(file);
});
afterEach(async () => {
  await handle.close();
  await trashTemporary(root);
});
const sourceFacts = (duration = 33) => ({
  format: { duration: String(duration) },
  streams: [
    { codec_type: 'video', codec_name: 'theora', width: 720, height: 400, avg_frame_rate: '25/1' },
    { codec_type: 'audio', codec_name: 'vorbis', sample_rate: '48000', channels: 2 },
  ],
});
const rendered = (frames = 990) => ({
  format: { duration: '.8' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 720,
      height: 400,
      nb_read_frames: String(frames),
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      sample_rate: '48000',
      nb_read_frames: String(frames === 990 ? 1547 : 35),
    },
  ],
});
it('uses closed vectors, verifies through EOF, and bounds a complete encoded copy without truncating flags', async () => {
  let count = 0;
  const execute = vi.fn<typeof runProcessor>(async () =>
    Buffer.from(
      JSON.stringify(++count === 1 ? sourceFacts() : count === 2 ? 'encoded' : rendered()),
    ),
  );
  const result = await videoDecoder('/bundled', execute)(
    { file, handle, info: await handle.stat() },
    'video',
    new AbortController().signal,
  );
  expect(result.kind).toBe('video');
  expect(result.extension).toBe('mp4');
  const command = execute.mock.calls[1]!;
  expect(command[1]).toContain('h264_videotoolbox');
  expect(command[1]).toContain('fd,pipe');
  expect(command[1]).toContain('-xerror');
  expect(command[1]).not.toContain('-fs');
  expect(command[1]).not.toContain('-t');
  expect(command[4]?.outputLimit).toBe(videoPreviewLimit);
  expect(execute.mock.calls[2]![1]).toContain('-count_frames');
  expect(await readFile(file, 'utf8')).toBe('generated source');
});
it('refuses a partial output even when it contains valid codecs and an initial MP4 fragment', async () => {
  let count = 0;
  const execute = vi.fn<typeof runProcessor>(async () =>
    Buffer.from(
      JSON.stringify(++count === 1 ? sourceFacts() : count === 2 ? 'encoded' : rendered(24)),
    ),
  );
  await expect(
    videoDecoder('/bundled', execute)(
      { file, handle, info: await handle.stat() },
      'video',
      new AbortController().signal,
    ),
  ).rejects.toThrow('complete compatibility copy');
});
it('refuses a source too long for the complete-copy budget before encoding', async () => {
  const execute = vi.fn<typeof runProcessor>(async () =>
    Buffer.from(JSON.stringify(sourceFacts(7200))),
  );
  await expect(
    videoDecoder('/bundled', execute)(
      { file, handle, info: await handle.stat() },
      'video',
      new AbortController().signal,
    ),
  ).rejects.toThrow('64 MB');
  expect(execute).toHaveBeenCalledTimes(1);
});
