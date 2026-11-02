import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ownedApp } from '../../tests/owned-app';

export type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;
const execute = promisify(execFile);

export async function screenshot(connection: Connection, file: string) {
  const result = await nativePNG(connection);
  await writeFile(file, Buffer.from(result.data, 'base64'), { flag: 'wx' });
}

async function nativePNG(connection: Connection) {
  const { cssVisualViewport } = await connection.command<{
    cssVisualViewport: { clientWidth: number; clientHeight: number; pageX: number; pageY: number };
  }>('Page.getLayoutMetrics');
  // An explicit CSS clip prevents device emulation from cropping to the top-left quadrant.
  const result = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: cssVisualViewport.pageX,
      y: cssVisualViewport.pageY,
      width: cssVisualViewport.clientWidth,
      height: cssVisualViewport.clientHeight,
      scale: 1,
    },
    captureBeyondViewport: false,
  });
  return result;
}

/** Record native PNG frames. The caller must set both device density and viewport scale. */
export async function recordFrames(
  connection: Connection,
  directory: string,
  actions: () => Promise<void>,
  options: { width: number; height: number; fps?: number },
) {
  const { width, height, fps = 30 } = options;
  assert.ok([width, height, fps].every((value) => Number.isInteger(value) && value > 0));
  assert.ok(width <= 3840 && height <= 2160 && fps <= 30, 'Bound lossless capture resources.');
  await mkdir(directory);
  const frames: { file: string; milliseconds: number }[] = [];
  let bytes = 0;
  let failure: unknown;
  const writes = new Set<Promise<void>>();
  const started = performance.now();
  async function accept(encoded: string) {
    assert.ok(
      frames.length < 2400 && bytes < 2_000_000_000,
      'Capture limit reached. Keep shorter takes.',
    );
    const milliseconds = performance.now() - started;
    const data = Buffer.from(encoded, 'base64');
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Lossless PNG required.');
    assert.deepEqual(
      [data.readUInt32BE(16), data.readUInt32BE(20)],
      [width, height],
      'Capture must contain native pixels at the requested size; never upscale it.',
    );
    const file = String(frames.length).padStart(5, '0') + '.png';
    frames.push({ file, milliseconds });
    bytes += data.length;
    await writeFile(path.join(directory, file), data, { flag: 'wx' });
  }
  // An idle compositor may not emit a frame until the first input. Seed the take without
  // blocking that input; subsequent frames come from the continuous compositor stream.
  const initial = await nativePNG(connection);
  await accept(initial.data);
  frames[0]!.milliseconds = 0;
  const off = connection.onEvent((method, params) => {
    if (method !== 'Page.screencastFrame' || failure) return;
    const work = accept(String(params.data))
      // Acknowledge only after writing, so Chromium bounds the outstanding frame buffers.
      .then(() => connection.command('Page.screencastFrameAck', { sessionId: params.sessionId }))
      .then(() => undefined)
      .catch((error: unknown) => {
        failure = error;
      });
    writes.add(work);
    void work.finally(() => writes.delete(work));
  });
  try {
    await connection.command('Page.startScreencast', {
      format: 'png',
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: Math.max(1, Math.round(60 / fps)),
    });
    await actions();
  } catch (error) {
    failure ??= error;
  } finally {
    await connection.command('Page.stopScreencast').catch((error: unknown) => {
      failure ??= error;
    });
    off();
    await Promise.all(writes);
    if (!failure) {
      try {
        const final = await nativePNG(connection);
        await accept(final.data);
      } catch (error) {
        failure = error;
      }
    }
    await writeFile(path.join(directory, 'timestamps.json'), JSON.stringify(frames), {
      flag: 'wx',
    });
  }
  if (failure) throw failure;
  const seconds = (performance.now() - started) / 1000;
  assert.ok(frames.length >= 2, 'Retain the beginning and end even when the compositor is idle.');
  const timeline = path.join(directory, 'frames.concat');
  const lines = frames.flatMap((frame, index) => [
    `file '${frame.file}'`,
    'option framerate 1000',
    'duration ' +
      Math.max(
        0.001,
        ((frames[index + 1]?.milliseconds ?? seconds * 1000) - frame.milliseconds) / 1000,
      ).toFixed(6),
  ]);
  lines.push(`file '${frames.at(-1)!.file}'`, 'option framerate 1000');
  await writeFile(timeline, lines.join('\n') + '\n', { flag: 'wx' });
  return {
    directory,
    timeline,
    width,
    height,
    frames: frames.length,
    seconds,
    bytes,
    fps: frames.length / seconds,
  };
}

/** Record delivered app frames with their real arrival times, including idle waits. */
export async function record(
  connection: Connection,
  directory: string,
  ffmpeg: string,
  actions: () => Promise<void>,
  options: { width?: number; height?: number; fps?: number; bitrate?: string; gif?: boolean } = {},
) {
  const { width = 1280, height = 800, fps = 12, bitrate = '1200k', gif = true } = options;
  assert.ok([width, height, fps].every((value) => Number.isInteger(value) && value > 0));
  assert.ok(width <= 1920 && height <= 1200 && fps <= 30, 'Bound capture resources.');
  assert.match(bitrate, /^\d+k$/);
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
    maxWidth: width,
    maxHeight: height,
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
  const seconds = (frames.at(-1)!.time - frames[0]!.time) / 1000;
  await writeFile(
    path.join(directory, 'timestamps.json'),
    JSON.stringify(
      frames.map((frame) => ({
        file: path.basename(frame.file),
        milliseconds: frame.time - frames[0]!.time,
      })),
    ),
    { flag: 'wx' },
  );
  // JPEG demuxing defaults to a 25 Hz time base. Preserve sub-frame arrival times before
  // resampling, so a burst of compositor frames does not lengthen the recording.
  const lines = frames.flatMap((frame, index) => [
    "file '" + path.basename(frame.file) + "'",
    'option framerate 1000',
    'duration ' +
      Math.max(0.001, ((frames[index + 1]?.time ?? frame.time + 800) - frame.time) / 1000).toFixed(
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
      // Electron can deliver a different frame size around a dialog or resize. Reinitializing
      // the fps filter would reset its timeline and discard part of the recorded wait.
      '-reinit_filter',
      '0',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      timeline,
      '-vf',
      `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      '-c:v',
      'h264_videotoolbox',
      '-allow_sw',
      '1',
      '-b:v',
      bitrate,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-t',
      String(seconds),
      video,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  if (gif)
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
    animation: gif ? animation : undefined,
    frames: frames.length,
    seconds,
  };
}
