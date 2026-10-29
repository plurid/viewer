import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { runProcessor } from '../transforms/process';
import { mediaDemuxer, mediaInfo } from '../transforms/media';
import type { Decoder, DerivedRendition, Source } from './derived';
import { errorMessage } from '../../domain/errors';

export const videoPreviewLimit = 64 * 1024 * 1024;
/** Complete local compatibility copy, never a shortened excerpt. Fixed vectors
 * and held descriptors only; no caller flags, filesystem outputs or network. */
export function videoDecoder(root: string, execute = runProcessor): Decoder {
  return async (source, _mode, signal) => {
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), 120000);
    const combined = AbortSignal.any([signal, deadline.signal]);
    try {
      const extension = source.format ?? path.extname(source.file).slice(1).toLowerCase(),
        demuxer = mediaDemuxer(extension);
      const probe = await execute(
        path.join(root, 'ffprobe'),
        [
          '-v',
          'error',
          '-max_alloc',
          '268435456',
          '-protocol_whitelist',
          'fd,pipe',
          '-f',
          demuxer,
          '-fd',
          '3',
          '-i',
          'fd:',
          '-show_entries',
          'format=duration:stream=codec_name,codec_type,width,height,duration,avg_frame_rate,sample_rate,channels:stream_side_data=rotation',
          '-of',
          'json',
        ],
        [source.handle.fd],
        combined,
        { timeout: 30000 },
      );
      const facts = mediaInfo(JSON.parse(probe.toString()), extension);
      if (!facts.video && facts.audio)
        return await audioCopy(root, execute, source, demuxer, facts.duration, combined);
      if (
        !facts.video ||
        !facts.width ||
        !facts.height ||
        Math.max(facts.width, facts.height) > 32768
      )
        throw new Error('This file has no supported video picture.');
      const bitrate = Math.min(
        2000000,
        Math.floor(((videoPreviewLimit - 1024 * 1024) * 8) / facts.duration) -
          (facts.audio ? 128000 : 0),
      );
      if (bitrate < 250000)
        throw new Error(
          'The complete video is too long for the 64 MB compatibility-preview limit. Open it in its original app.',
        );
      // Probing seeks the inherited open description. Reopen independently after
      // checking that it still names the same exact source version.
      const input = await open(
        source.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let data: Buffer;
      try {
        const current = await input.stat();
        if (
          current.dev !== source.info.dev ||
          current.ino !== source.info.ino ||
          current.mtimeMs !== source.info.mtimeMs ||
          current.ctimeMs !== source.info.ctimeMs ||
          current.size !== source.info.size
        )
          throw new Error('The video changed before conversion. Reopen its preview.');
        data = await execute(
          path.join(root, 'ffmpeg'),
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-xerror',
            '-max_alloc',
            '268435456',
            '-threads',
            '2',
            '-filter_threads',
            '2',
            '-protocol_whitelist',
            'fd,pipe',
            '-f',
            demuxer,
            '-fd',
            '3',
            '-i',
            'fd:',
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-sn',
            '-dn',
            '-vf',
            "scale=w='min(iw,1280)':h='min(ih,720)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",
            '-c:v',
            'h264_videotoolbox',
            '-allow_sw',
            '1',
            '-pix_fmt',
            'yuv420p',
            '-b:v',
            String(bitrate),
            '-maxrate',
            String(bitrate),
            '-bufsize',
            String(bitrate * 2),
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ac',
            '2',
            '-ar',
            '48000',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-threads',
            '2',
            '-movflags',
            'frag_keyframe+empty_moov+default_base_moof',
            '-f',
            'mp4',
            'pipe:1',
          ],
          [input.fd],
          combined,
          { timeout: 120000, outputLimit: videoPreviewLimit },
        );
      } finally {
        await input.close();
      }
      const checked = await execute(
        path.join(root, 'ffprobe'),
        [
          '-v',
          'error',
          '-max_alloc',
          '268435456',
          '-protocol_whitelist',
          'pipe',
          '-f',
          'mov',
          '-i',
          'pipe:0',
          '-count_frames',
          '-show_entries',
          'format=duration:stream=codec_name,codec_type,width,height,duration,avg_frame_rate,sample_rate,channels,nb_read_frames',
          '-of',
          'json',
        ],
        [],
        combined,
        { input: data, timeout: 30000 },
      );
      const inspection = JSON.parse(checked.toString()) as {
        format?: { duration?: string };
        streams?: { codec_type?: string; nb_read_frames?: string; sample_rate?: string }[];
      };
      // A nonseekable fragmented MP4 initially reports only its first fragment's
      // duration. Count every decoded frame through EOF before accepting the copy.
      const durations =
        inspection.streams?.map(
          (stream) =>
            Number(stream.nb_read_frames) /
            (stream.codec_type === 'video' ? 30 : Number(stream.sample_rate) / 1024),
        ) ?? [];
      const duration = Math.max(...durations.filter(Number.isFinite));
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error('The compatibility copy could not be verified through its final frame.');
      const result = mediaInfo(
        { ...inspection, format: { ...inspection.format, duration: String(duration) } },
        'mp4',
      );
      if (
        result.videoCodec !== 'h264' ||
        (facts.audio && result.audioCodec !== 'aac') ||
        result.width > 1280 ||
        result.height > 720 ||
        Math.abs(result.duration - facts.duration) > 0.25
      )
        throw new Error(
          'A complete compatibility copy could not be verified. Open this video in its original app.',
        );
      return { data, extension: 'mp4', kind: 'video', decoder: 'FFmpeg 9.0.2' };
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new Error('Video preview cancelled.');
      if (deadline.signal.aborted)
        throw new Error(
          'Local video conversion exceeded two minutes. Open the file in its original app.',
        );
      const message = errorMessage(error);
      if (message.includes('output exceeded'))
        throw new Error(
          'The complete compatibility copy exceeds 64 MB. Open this video in its original app.',
        );
      if (message.includes('Media processor failed'))
        throw new Error(
          'A compatible video copy could not be decoded. Open the file in its original app.',
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Sound Chromium cannot play (WMA, AIFF, CAF, APE and others) as a complete AAC copy, checked
 * through its final frame like the video copy. */
async function audioCopy(
  root: string,
  execute: typeof runProcessor,
  source: Source,
  demuxer: string,
  duration: number,
  signal: AbortSignal,
): Promise<DerivedRendition> {
  if (!(duration > 0) || duration * 24_000 > videoPreviewLimit - 1024 * 1024)
    throw new Error(
      'The complete recording is too long for the 64 MB compatibility-preview limit. Open it in its original app.',
    );
  const input = await open(
    source.file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let data: Buffer;
  try {
    const current = await input.stat();
    if (
      current.dev !== source.info.dev ||
      current.ino !== source.info.ino ||
      current.mtimeMs !== source.info.mtimeMs ||
      current.size !== source.info.size
    )
      throw new Error('The recording changed before conversion. Reopen its preview.');
    data = await execute(
      path.join(root, 'ffmpeg'),
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-xerror',
        '-max_alloc',
        '268435456',
        '-threads',
        '2',
        '-protocol_whitelist',
        'fd,pipe',
        '-f',
        demuxer,
        '-fd',
        '3',
        '-i',
        'fd:',
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-map_metadata',
        '-1',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        '-f',
        'mp4',
        'pipe:1',
      ],
      [input.fd],
      signal,
      { timeout: 120000, outputLimit: videoPreviewLimit },
    );
  } finally {
    await input.close();
  }
  const checked = await execute(
    path.join(root, 'ffprobe'),
    [
      '-v',
      'error',
      '-max_alloc',
      '268435456',
      '-protocol_whitelist',
      'pipe',
      '-f',
      'mov',
      '-i',
      'pipe:0',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,codec_type,sample_rate,nb_read_frames',
      '-of',
      'json',
    ],
    [],
    signal,
    { input: data, timeout: 30000 },
  );
  const stream = (
    JSON.parse(checked.toString()) as {
      streams?: {
        codec_name?: string;
        codec_type?: string;
        sample_rate?: string;
        nb_read_frames?: string;
      }[];
    }
  ).streams?.find((item) => item.codec_type === 'audio');
  // AAC frames hold 1024 samples each
  const copied = (Number(stream?.nb_read_frames) * 1024) / Number(stream?.sample_rate);
  if (stream?.codec_name !== 'aac' || !(Math.abs(copied - duration) <= 0.25))
    throw new Error(
      'A complete compatibility copy could not be verified. Open this recording in its original app.',
    );
  return { data, extension: 'm4a', kind: 'video', decoder: 'FFmpeg 9.0.2' };
}
