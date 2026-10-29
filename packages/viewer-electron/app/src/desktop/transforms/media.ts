import type { MediaTransform } from '../../domain/operations/transforms';

import type { MediaInfo } from '../../domain/media/documents';
export const mediaDemuxer = (extension: string): string => {
  const formats: Record<string, string> = {
    mp4: 'mov',
    m4v: 'mov',
    mov: 'mov',
    m4a: 'mov',
    mp3: 'mp3',
    wav: 'wav',
    flac: 'flac',
    ogg: 'ogg',
    ogv: 'ogg',
    oga: 'ogg',
    opus: 'ogg',
    aif: 'aiff',
    aiff: 'aiff',
    caf: 'caf',
    avi: 'avi',
    mkv: 'matroska',
    webm: 'matroska',
    aac: 'aac',
    mpg: 'mpeg',
    mpeg: 'mpeg',
    ts: 'mpegts',
    m2ts: 'mpegts',
    mts: 'mpegts',
    wmv: 'asf',
    wma: 'asf',
    asf: 'asf',
    flv: 'flv',
    '3gp': 'mov',
    '3g2': 'mov',
    vob: 'mpeg',
    mxf: 'mxf',
    mka: 'matroska',
    ac3: 'ac3',
    amr: 'amr',
    ape: 'ape',
    wv: 'wv',
  };
  const format = formats[extension.toLowerCase()];
  if (!format) throw new Error('Choose a supported audio or video file.');
  return format;
};
export function mediaInfo(value: unknown, extension: string): MediaInfo {
  const raw = value as {
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
      sample_rate?: string;
      channels?: number;
      side_data_list?: { rotation?: number }[];
    }[];
    format?: { duration?: string };
  };
  const video = raw.streams?.find((stream) => stream.codec_type === 'video'),
    audio = raw.streams?.find((stream) => stream.codec_type === 'audio');
  const ratio = video?.avg_frame_rate?.split('/').map(Number);
  const fps = ratio?.[0] && ratio[1] ? ratio[0] / ratio[1] : 30;
  const rotated =
    Math.abs(video?.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? 0) %
      180 ===
    90;
  const duration = Number(raw.format?.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || (!video && !audio))
    throw new Error('This media has no supported duration, or is longer than 24 hours.');
  return {
    extension,
    duration,
    width: rotated ? video?.height || 0 : video?.width || 0,
    height: rotated ? video?.width || 0 : video?.height || 0,
    fps: Number.isFinite(fps) ? Math.max(1, Math.min(120, fps)) : 30,
    video: !!video,
    audio: !!audio,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    sampleRate: Number(audio?.sample_rate) || undefined,
    channels: audio?.channels,
  };
}
export interface MediaCommand {
  args: string[];
  sources: number[];
  duration: number;
  copied: boolean;
}
/** Typed values become fixed argument vectors. No caller supplies shell text,
 * arbitrary flags, filter graphs, output paths or network protocols. */
export function compileMedia(
  plan: MediaTransform,
  facts: readonly MediaInfo[],
  descriptor: (input: number) => number,
  outputFD: number,
): MediaCommand {
  const video = ['mp4', 'mov', 'png', 'jpeg'].includes(plan.format);
  const frame = ['png', 'jpeg'].includes(plan.format);
  for (const segment of plan.segments) {
    const info = facts[segment.source];
    if (!info || segment.end > info.duration + 0.001 || segment.start >= info.duration)
      throw new Error('A segment is outside its source duration.');
    if (video && !info.video) throw new Error('Every video segment must have a video stream.');
    if (!video && !info.audio) throw new Error('Every audio segment must have an audio stream.');
  }
  const sources = plan.segments.map((segment) => segment.source);
  const duration = plan.segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const first = facts[sources[0]!]!;
  const whole =
    plan.segments.length === 1 &&
    plan.segments[0]!.start === 0 &&
    Math.abs(plan.segments[0]!.end - first.duration) < 0.001;
  const copied =
    video &&
    !frame &&
    (plan.cut === 'keyframe' ||
      (whole && plan.audio.mode === 'keep' && plan.quality === 'balanced')) &&
    first.videoCodec === 'h264' &&
    (!first.audio || first.audioCodec === 'aac');
  if (plan.cut === 'keyframe' && !copied)
    throw new Error(
      'Fast cuts require H.264 video with AAC audio in MP4 or MOV. Choose Exact for this file.',
    );
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-max_alloc',
    '268435456',
    '-filter_complex_threads',
    '2',
  ];
  const input = (source: number, index: number, start?: number, length?: number) => {
    args.push(
      '-threads',
      '2',
      '-protocol_whitelist',
      'fd,pipe',
      '-f',
      mediaDemuxer(facts[source]!.extension),
    );
    if (start) args.push('-ss', String(start));
    if (length) args.push('-t', String(length));
    args.push('-fd', String(descriptor(index)), '-i', 'fd:');
  };
  plan.segments.forEach((segment, index) =>
    input(segment.source, index, segment.start, segment.end - segment.start),
  );
  if (copied)
    args.push(
      '-map',
      '0:v:0',
      ...(plan.audio.mode !== 'mute' && first.audio ? ['-map', '0:a:0'] : []),
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
    );
  else if (frame)
    args.push(
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-an',
      '-c:v',
      plan.format === 'png' ? 'png' : 'mjpeg',
      ...(plan.format === 'jpeg' ? ['-q:v', '2'] : []),
    );
  else {
    const filters: string[] = [],
      channels: string[] = [];
    const width = Math.max(2, Math.floor(first.width / 2) * 2),
      height = Math.max(2, Math.floor(first.height / 2) * 2);
    if (video && (width > 8192 || height > 8192))
      throw new Error('Video export is limited to 8192 pixels per edge.');
    const includeAudio = !video || plan.audio.mode !== 'mute';
    plan.segments.forEach((segment, index) => {
      const length = segment.end - segment.start;
      if (video) {
        filters.push(
          `[${index}:v:0]trim=duration=${length},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${first.fps}[v${index}]`,
        );
        channels.push(`[v${index}]`);
      }
      if (includeAudio) {
        filters.push(
          facts[segment.source]!.audio
            ? `[${index}:a:0]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${index}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${length}[a${index}]`,
        );
        channels.push(`[a${index}]`);
      }
    });
    filters.push(
      `${channels.join('')}concat=n=${plan.segments.length}:v=${video ? 1 : 0}:a=${includeAudio ? 1 : 0}${video ? '[video]' : ''}${includeAudio ? '[original]' : ''}`,
    );
    let audio = '[original]';
    if (includeAudio && ['mix', 'replace'].includes(plan.audio.mode)) {
      const source = plan.audio.source!;
      if (!facts[source]?.audio) throw new Error('The chosen audio source has no audio stream.');
      const index = sources.length;
      sources.push(source);
      input(source, index);
      const offset = plan.audio.offset;
      filters.push(
        `[${index}:a:0]${offset < 0 ? `atrim=start=${-offset},asetpts=PTS-STARTPTS,` : ''}aresample=48000,aformat=channel_layouts=stereo,volume=${plan.audio.gain}${offset > 0 ? `,adelay=${Math.round(offset * 1000)}:all=1` : ''},apad,atrim=duration=${duration}[overlay]`,
      );
      if (plan.audio.mode === 'mix') {
        filters.push(
          `[original]volume=${plan.audio.originalGain}[base];[base][overlay]amix=inputs=2:duration=first:normalize=0[audio]`,
        );
        audio = '[audio]';
      } else {
        filters.push('[original]anullsink');
        audio = '[overlay]';
      }
    }
    args.push('-filter_complex', filters.join(';'));
    if (video)
      args.push(
        '-map',
        '[video]',
        '-c:v',
        'h264_videotoolbox',
        '-allow_sw',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-b:v',
        String(
          Math.round(
            width * height * first.fps * { small: 0.04, balanced: 0.08, high: 0.14 }[plan.quality],
          ),
        ),
      );
    if (includeAudio)
      args.push(
        '-map',
        audio,
        '-c:a',
        plan.format === 'wav' ? 'pcm_s16le' : plan.format === 'flac' ? 'flac' : 'aac',
        ...(!['wav', 'flac'].includes(plan.format)
          ? ['-b:a', plan.quality === 'small' ? '128k' : '192k']
          : []),
      );
    else args.push('-an');
  }
  const format = frame ? 'image2pipe' : plan.format === 'm4a' ? 'mp4' : plan.format;
  args.push(
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-threads',
    '2',
    '-progress',
    'pipe:1',
    '-f',
    format,
    '-fd',
    String(outputFD),
    'fd:',
  );
  return { args, sources, duration, copied };
}
