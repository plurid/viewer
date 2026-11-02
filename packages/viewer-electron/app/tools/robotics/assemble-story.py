"""Encode a native story capture once, with an exact transcript and temporary narration."""

import hashlib
import json
import math
import pathlib
import struct
import subprocess
import sys
import tempfile
import textwrap
import wave

from PIL import Image, ImageDraw, ImageFont

FFMPEG = '/opt/homebrew/bin/ffmpeg'
FFPROBE = '/opt/homebrew/bin/ffprobe'
FONT = '/System/Library/Fonts/Helvetica.ttc'
SIZE = (2880, 1800)


def run(args, timeout=120):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr[-5000:])
    return result.stdout


def probe(file):
    return json.loads(run([FFPROBE, '-v', 'error', '-show_streams', '-show_format',
                           '-of', 'json', str(file)]))


def store(file, value):
    with file.open('x') as stream:
        json.dump(value, stream, indent=2)


def stamp(seconds, srt=False):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}{"," if srt else "."}{milliseconds:03}'


def concat_entry(file, seconds):
    escaped = str(file).replace("'", "'\\''")
    return [f"file '{escaped}'", 'option framerate 1000', f'duration {seconds:.6f}']


def verify_png(file):
    with file.open('rb') as stream:
        header = stream.read(24)
    assert header[:8] == b'\x89PNG\r\n\x1a\n', file
    assert struct.unpack('>II', header[16:24]) == SIZE, ('Never upscale source frames', file)


source = pathlib.Path(sys.argv[1]).resolve()
assert json.loads((source / 'story-completed.json').read_text())['status'] == 'passed'
capture = json.loads((source / 'story-capture.json').read_text())
assert capture['providerRequests'] == 0 and len(capture['clips']) == 8
assert (capture['width'], capture['height']) == SIZE
root = pathlib.Path(tempfile.mkdtemp(prefix='viewer-interface-review-', dir='/private/tmp'))
for name in ['Voice', 'Captions', 'Review']:
    (root / name).mkdir()
print(json.dumps({'output': str(root)}), flush=True)

opening = [
    (0, 3, 'Do not try and use the interface.'),
    (3, 4.7, "That's impossible."),
    (4.7, 6.2, 'Realize the truth.'),
    (6.2, 8.5, 'There is no interface.'),
]
picture = []
slots = []
for index, (start, end, text) in enumerate(opening):
    image = Image.new('RGB', SIZE, '#22262c')
    draw = ImageDraw.Draw(image)
    draw.text((1440, 860), text, anchor='mm', font=ImageFont.truetype(FONT, 76), fill='#f3f4f6')
    file = root / f'opening-{index}.png'
    image.save(file)
    picture.extend(concat_entry(file, end - start))
    slots.append({'start': start, 'end': end, 'text': text, 'opening': True})

cursor = opening[-1][1]
samples = []
source_frames = 0
for clip in capture['clips']:
    directory = pathlib.Path(clip['directory'])
    frames = json.loads((directory / 'timestamps.json').read_text())
    assert len(frames) == clip['frames'] and len(frames) >= 2
    assert (clip['width'], clip['height']) == SIZE
    previous = -1
    for index, frame in enumerate(frames):
        milliseconds = 0 if index == 0 else frame['milliseconds']
        assert milliseconds >= previous
        previous = milliseconds
        next_time = frames[index + 1]['milliseconds'] / 1000 if index + 1 < len(frames) else clip['seconds']
        length = next_time - milliseconds / 1000
        assert length >= 0
        file = directory / frame['file']
        verify_png(file)
        picture.extend(concat_entry(file, max(.001, length)))
    source_frames += len(frames)
    for index, mark in enumerate(clip['marks']):
        end = clip['marks'][index + 1]['seconds'] if index + 1 < len(clip['marks']) else clip['seconds']
        slots.append({'start': cursor + mark['seconds'], 'end': cursor + end,
                      'text': mark['narration'], 'action': mark['action']})
        samples.append({'time': cursor + mark['seconds'] + min(3, (end - mark['seconds']) * .6),
                        'action': mark['action']})
    clip.update(editStart=cursor, editEnd=cursor + clip['seconds'])
    cursor += clip['seconds']

picture_end = cursor
duration = math.ceil((picture_end + 7) * 30) / 30
assert duration <= 180, ('Keep the full cut under three minutes', duration)
image = Image.new('RGB', SIZE, '#22262c')
draw = ImageDraw.Draw(image)
draw.text((160, 380), 'Viewer / There Is No Interface', font=ImageFont.truetype(FONT, 76), fill='#f3f4f6')
credits = [
    'Viewer + Plurid: existing projects',
    'Hackathon: generated canvases, revisions, saved inputs and source-based checks',
    'Meta muse-spark-1.3 · Robot: TheRobotStudio / SO-ARM100',
    'Saved responses · Condensed repairs · Staged reveals and local layout refinements',
    'Temporary opening and voice · Kinematic endpoints, no path or hardware simulation',
]
for index, text in enumerate(credits):
    draw.text((160, 580 + index * 88), text, font=ImageFont.truetype(FONT, 39), fill='#b8c0cc')
credits_file = root / 'credits.png'
image.save(credits_file)
picture.extend(concat_entry(credits_file, duration - picture_end))
picture.extend(concat_entry(credits_file, .001)[:2])
(root / 'picture.concat').write_text('\n'.join(picture) + '\n')

cues = []
for index, slot in enumerate(slots):
    prefix = root / 'Voice' / f'{index:02}'
    prefix.with_suffix('.txt').write_text(slot['text'] + '\n')
    run(['/usr/bin/say', '-v', 'Daniel', '-r', '172', '-f', str(prefix.with_suffix('.txt')),
         '-o', str(prefix.with_suffix('.aiff'))])
    wav = prefix.with_suffix('.wav')
    run([FFMPEG, '-n', '-v', 'error', '-threads', '2', '-i', str(prefix.with_suffix('.aiff')),
         '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', str(wav)])
    length = float(probe(wav)['format']['duration'])
    room = slot['end'] - slot['start']
    assert length + .06 <= room, ('Narration does not fit its recorded action', slot, length, str(root))
    start = slot['start'] + (room - length) / 2
    cues.append({**slot, 'start': start, 'end': start + length, 'audio': str(wav)})
    print(json.dumps({'cue': index, 'spoken': round(length, 2), 'slot': round(room, 2)}), flush=True)

pcm = bytearray(math.ceil(duration * 48000) * 2)
for cue in cues:
    with wave.open(cue['audio'], 'rb') as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 48000)
        data = audio.readframes(audio.getnframes())
    offset = round(cue['start'] * 48000) * 2
    pcm[offset:offset + len(data)] = data
with wave.open(str(root / 'narration.wav'), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(48000)
    audio.writeframes(pcm)
with (root / 'Narration.txt').open('x') as text:
    text.write('THERE IS NO INTERFACE / EXACT NARRATION OF THIS REVIEW CUT\n\nTemporary system voice: Daniel.\n\n')
    for cue in cues:
        text.write(f"{stamp(cue['start'])} - {stamp(cue['end'])}\n{cue['text']}\n\n")
with (root / 'Captions.srt').open('x') as text:
    for index, cue in enumerate(cues):
        text.write(f"{index + 1}\n{stamp(cue['start'], True)} --> {stamp(cue['end'], True)}\n{cue['text']}\n\n")

boundaries = sorted({0, duration, *[point for cue in cues for point in [cue['start'], cue['end']]]})
timeline = []
for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
    image = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cue = next((c for c in cues if c['start'] <= (start + end) / 2 < c['end']), None)
    if cue and not cue.get('opening'):
        font = ImageFont.truetype(FONT, 42)
        lines = textwrap.wrap(cue['text'], width=104)
        assert len(lines) <= 2
        width = max(draw.textlength(line, font=font) for line in lines)
        top = 134
        draw.rectangle((1440 - width / 2 - 24, top, 1440 + width / 2 + 24,
                        top + 50 * len(lines) + 12), fill=(32, 36, 43, 245))
        for row, line in enumerate(lines):
            draw.text((1440, top + 6 + row * 50), line, anchor='mt', font=font, fill='#f3f4f6')
    file = root / 'Captions' / f'{index:02}.png'
    image.save(file)
    timeline.extend(concat_entry(file, end - start))
timeline.extend(concat_entry(file, .001)[:2])
(root / 'captions.concat').write_text('\n'.join(timeline) + '\n')
store(root / 'script.json', {'source': str(source), 'duration': duration, 'pictureEnd': picture_end,
                            'cues': cues, 'clips': capture['clips'], 'providerRequests': 0})

output = root / 'Viewer - There Is No Interface - review.mp4'
print(json.dumps({'encoding': str(output), 'seconds': duration, 'nativeFrames': source_frames}), flush=True)
run([FFMPEG, '-n', '-v', 'warning', '-threads', '2', '-filter_complex_threads', '2',
     '-f', 'concat', '-safe', '0', '-i', str(root / 'picture.concat'),
     '-f', 'concat', '-safe', '0', '-i', str(root / 'captions.concat'),
     '-i', str(root / 'narration.wav'),
     '-filter_complex', '[0:v]fps=30[base];[base][1:v]overlay=0:0:format=auto[v]',
     '-map', '[v]', '-map', '2:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
     '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
     '-t', str(duration), '-movflags', '+faststart', str(output)], timeout=900)
run([FFMPEG, '-v', 'error', '-threads', '2', '-i', str(output),
     '-map', '0:v', '-map', '0:a', '-f', 'null', '-'], timeout=240)
info = probe(output)
stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
assert (stream['width'], stream['height']) == SIZE
assert stream['avg_frame_rate'] == '30/1'
assert abs(float(info['format']['duration']) - duration) < .1
files = []
for index, sample in enumerate(samples):
    file = root / 'Review' / f'{index:02}-{sample["action"]}.png'
    run([FFMPEG, '-n', '-v', 'error', '-threads', '2', '-ss', str(sample['time']),
         '-i', str(output), '-frames:v', '1', str(file)])
    files.append(file)
sheet = Image.new('RGB', (1440, math.ceil(len(files) / 3) * 322), '#15181d')
draw = ImageDraw.Draw(sheet)
for index, file in enumerate(files):
    thumbnail = Image.open(file)
    thumbnail.thumbnail((480, 300))
    x, y = index % 3 * 480, index // 3 * 322
    sheet.paste(thumbnail, (x, y))
    draw.text((x + 8, y + 302), file.stem, fill='white')
sheet.save(root / 'Review/contact.png')
with output.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
store(root / 'verification.json', {'status': 'technical-checks-passed', 'duration': duration,
      'sourceCapture': str(source), 'video': str(output), 'sha256': digest, 'resolution': SIZE,
      'sourceFrames': source_frames, 'sourceEncoding': 'PNG', 'videoEncodes': 1,
      'providerRequests': 0, 'voice': 'Temporary system voice', 'playbackSpeed': 1,
      'inputs': sum(len(c['inputs']) for c in capture['clips'])})
print(json.dumps({'video': str(output), 'script': str(root / 'Narration.txt'), 'seconds': duration}), flush=True)
