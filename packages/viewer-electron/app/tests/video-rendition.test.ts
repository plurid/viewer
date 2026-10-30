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
it('copies sound without a picture to AAC and checks it through its last frame', async () => {
  const sound = path.join(root, 'voice.wma');
  await writeFile(sound, 'generated source');
  const source = await open(sound);
  try {
    const facts = {
      format: { duration: '3' },
      streams: [{ codec_type: 'audio', codec_name: 'wmav2', sample_rate: '44100', channels: 1 }],
    };
    // 3 s at 48 kHz is 140.625 AAC frames; the copy is checked within a quarter second
    const copy = (frames: number) => ({
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '48000',
          nb_read_frames: String(frames),
        },
      ],
    });
    const run = (frames: number) => {
      let count = 0;
      return vi.fn<typeof runProcessor>(async () =>
        Buffer.from(JSON.stringify(++count === 1 ? facts : count === 2 ? 'encoded' : copy(frames))),
      );
    };
    const execute = run(141);
    const result = await videoDecoder('/bundled', execute)(
      { file: sound, handle: source, info: await source.stat() },
      'video',
      new AbortController().signal,
    );
    expect(result.extension).toBe('m4a');
    const command = execute.mock.calls[1]![1];
    expect(command).toEqual(expect.arrayContaining(['-f', 'asf', '-map', '0:a:0', '-vn', 'aac']));
    expect(command).toContain('fd,pipe');
    await expect(
      videoDecoder('/bundled', run(40))(
        { file: sound, handle: source, info: await source.stat() },
        'video',
        new AbortController().signal,
      ),
    ).rejects.toThrow('could not be verified');
  } finally {
    await source.close();
  }
});
it('counts the frames of a raw elementary stream, which states no duration', async () => {
  const picture = {
    format: {},
    streams: [{ codec_type: 'video', codec_name: 'mpeg2video', width: 320, height: 240 }],
  };
  const run = (counted: unknown) => {
    let count = 0;
    return vi.fn<typeof runProcessor>(async () =>
      Buffer.from(
        ++count === 1
          ? JSON.stringify(picture)
          : count === 2
            ? JSON.stringify(counted)
            : count === 3
              ? 'encoded'
              : JSON.stringify(rendered(60)),
      ),
    );
  };
  // 24 frames at 12 a second: two seconds, as the copy's 60 frames at 30 are
  const execute = run({ streams: [{ nb_read_packets: '24', r_frame_rate: '12/1' }] });
  const result = await videoDecoder('/bundled', execute)(
    { file, handle, info: await handle.stat() },
    'video',
    new AbortController().signal,
  );
  expect(result.extension).toBe('mp4');
  const [, counting, descriptors] = execute.mock.calls[1]!;
  expect(counting).toEqual(expect.arrayContaining(['-count_packets', '-select_streams', 'v:0']));
  // the probe moved the inherited descriptor: the count reads its own
  expect(descriptors).not.toEqual([handle.fd]);
  await expect(
    videoDecoder('/bundled', run({ streams: [] }))(
      { file, handle, info: await handle.stat() },
      'video',
      new AbortController().signal,
    ),
  ).rejects.toThrow('no supported duration');
});
