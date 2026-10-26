import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ownedApp } from '../../tests/owned-app';

export type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;
const execute = promisify(execFile);

export async function screenshot(connection: Connection, file: string) {
  const result = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(file, Buffer.from(result.data, 'base64'), { flag: 'wx' });
}

/** Record delivered app frames with their real arrival times, including idle waits. */
export async function record(
  connection: Connection,
  directory: string,
  ffmpeg: string,
  actions: () => Promise<void>,
) {
  await mkdir(directory);
  const frames: { file: string; time: number }[] = [];
  const writes: Promise<void>[] = [];
  const accept = (data: string) => {
    const file = path.join(directory, String(frames.length).padStart(5, '0') + '.jpg');
    frames.push({ file, time: performance.now() });
    writes.push(writeFile(file, Buffer.from(data, 'base64'), { flag: 'wx' }));
  };
  const first = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 88,
  });
  accept(first.data);
  const off = connection.onEvent((method, params) => {
    if (method !== 'Page.screencastFrame') return;
    accept(String(params.data));
    void connection.command('Page.screencastFrameAck', { sessionId: params.sessionId });
  });
  await connection.command('Page.startScreencast', {
    format: 'jpeg',
    quality: 88,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 1,
  });
  try {
    await actions();
  } finally {
    await connection.command('Page.stopScreencast');
    off();
    await Promise.all(writes);
  }
  const last = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 88,
  });
  accept(last.data);
  await Promise.all(writes);
  assert.ok(frames.length >= 3, 'The app delivered actual recording frames.');
  const lines = frames.flatMap((frame, index) => [
    "file '" + path.basename(frame.file) + "'",
    'duration ' +
      Math.max(0.04, ((frames[index + 1]?.time ?? frame.time + 800) - frame.time) / 1000).toFixed(
        3,
      ),
  ]);
  const timeline = path.join(directory, 'frames.txt');
  await writeFile(timeline, lines.join('\n') + '\n', { flag: 'wx' });
  const video = path.join(directory, 'demo.mp4'),
    animation = path.join(directory, 'demo.gif');
  await execute(
    ffmpeg,
    [
      '-n',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      timeline,
      '-vf',
      'fps=12,scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2',
      '-c:v',
      'h264_videotoolbox',
      '-allow_sw',
      '1',
      '-b:v',
      '1200k',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      video,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  await execute(
    ffmpeg,
    [
      '-n',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      video,
      '-filter_complex',
      'fps=5,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop',
      '0',
      animation,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  return {
    video,
    animation,
    frames: frames.length,
    seconds: (frames.at(-1)!.time - frames[0]!.time) / 1000,
  };
}
