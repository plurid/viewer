"""Assemble a retained native capture and its exact temporary narration. Never removes inputs."""
import hashlib
import json
import math
import pathlib
import subprocess
import sys
import tempfile
import textwrap
import wave
from PIL import Image, ImageDraw, ImageFont

FFMPEG = '/opt/homebrew/bin/ffmpeg'
FFPROBE = '/opt/homebrew/bin/ffprobe'
FONT = '/System/Library/Fonts/Helvetica.ttc'


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr[-5000:])
    return result.stdout


def probe(file):
    return json.loads(run([FFPROBE, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)]))


def store(file, value):
    with file.open('x') as stream:
        json.dump(value, stream, indent=2)


def stamp(seconds, srt=False):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}{"," if srt else "."}{milliseconds:03}'


source = pathlib.Path(sys.argv[1]).resolve()
assert json.loads((source / 'completed.json').read_text())['status'] == 'passed'
capture = json.loads((source / 'capture.json').read_text())
assert capture['providerRequests'] == 0 and len(capture['clips']) == 3
root = pathlib.Path(tempfile.mkdtemp(prefix='viewer-mounting-edit-', dir='/private/tmp'))
for name in ['Voice', 'Captions', 'Review']:
    (root / name).mkdir()
print(json.dumps({'output': str(root)}), flush=True)
slots = []
cursor = 0
for index, clip in enumerate(capture['clips']):
    info = probe(clip['video'])
    length = float(info['format']['duration'])
    stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
    assert (stream['width'], stream['height']) == (1440, 900)
    marks = {m['action']: m['seconds'] for m in clip['marks']}
    if index == 0:
        lines = [
            (.3, marks['generated'] - .1, 'I need a mounting plate. I ask Meta to build the tool from these files.'),
            (marks['generated'] + .1, marks['width'], 'The base, the drawing, and editable dimensions.'),
            (marks['width'] + .1, marks['saved-dxf'], 'Make it a hundred and eighty millimetres wide. Viewer checks the drawing.'),
            (marks['saved-dxf'] + .1, length - .1, 'Save it. Open the DXF.'),
        ]
    elif index == 1:
        lines = [(.1, length - .1, 'The demo cutting service offers forty euros in a week, or sixty-five in two days.')]
    else:
        lines = [
            (.3, marks['deadline'] - .1, 'I ask Meta to turn that reply into a comparison.'),
            (marks['deadline'] + .1, marks['choice'], 'I can wait a week.'),
            (marks['choice'] + .1, marks['saved-quote'], 'Economy fits. Forty euros. Save that choice.'),
            (marks['saved-quote'] + .1, length - .1, 'Open the saved quote.'),
        ]
    for start, end, text in lines:
        slots.append({'start': cursor + start, 'end': cursor + end, 'text': text})
    clip.update(editStart=cursor, editEnd=cursor + length)
    cursor += length
picture_end = cursor
duration = math.ceil((picture_end + 5) * 30) / 30
cues = []
for index, slot in enumerate(slots):
    prefix = root / 'Voice' / f'{index:02}'
    prefix.with_suffix('.txt').write_text(slot['text'] + '\n')
    run(['/usr/bin/say', '-v', 'Daniel', '-r', '172', '-f', str(prefix.with_suffix('.txt')), '-o', str(prefix.with_suffix('.aiff'))])
    wav = prefix.with_suffix('.wav')
    run([FFMPEG, '-n', '-v', 'error', '-threads', '2', '-i', str(prefix.with_suffix('.aiff')), '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', str(wav)])
    length = float(probe(wav)['format']['duration'])
    room = slot['end'] - slot['start']
    assert length + .08 <= room, ('Rewrite narration to fit the shot', slot, length, room, str(root))
    start = slot['start'] + (room - length) / 2
    cues.append({'text': slot['text'], 'start': start, 'end': start + length, 'audio': str(wav)})
    print(json.dumps({'cue': index, 'spoken': round(length, 2), 'slot': round(room, 2)}), flush=True)

pcm = bytearray(math.ceil(duration * 48000) * 2)
for cue in cues:
    with wave.open(cue['audio'], 'rb') as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 48000)
        data = audio.readframes(audio.getnframes())
    offset = round(cue['start'] * 48000) * 2
    pcm[offset:offset + len(data)] = data
with wave.open(str(root / 'narration.wav'), 'wb') as audio:
    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(48000); audio.writeframes(pcm)
with (root / 'Narration.txt').open('x') as text:
    text.write('MOUNTING JOB / ACTUAL NARRATION OF THIS REVIEW CUT\n\nTemporary system voice: Daniel.\n\n')
    for cue in cues:
        text.write(f"{stamp(cue['start'])} - {stamp(cue['end'])}\n{cue['text']}\n\n")
with (root / 'Captions.srt').open('x') as text:
    for index, cue in enumerate(cues):
        text.write(f"{index + 1}\n{stamp(cue['start'], True)} --> {stamp(cue['end'], True)}\n{cue['text']}\n\n")

boundaries = sorted({0, duration, *[point for cue in cues for point in [cue['start'], cue['end']]]})
timeline = []
for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
    image = Image.new('RGBA', (1440, 900), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cue = next((c for c in cues if c['start'] <= (start + end) / 2 < c['end']), None)
    if cue:
        font = ImageFont.truetype(FONT, 22)
        lines = textwrap.wrap(cue['text'], width=90)
        assert len(lines) <= 2
        width = max(draw.textlength(line, font=font) for line in lines)
        top = 68
        draw.rectangle((720 - width / 2 - 14, top, 720 + width / 2 + 14, top + 28 * len(lines) + 8), fill=(32, 36, 43, 240))
        for row, line in enumerate(lines):
            draw.text((720, top + 4 + row * 28), line, anchor='mt', font=font, fill='#f2f4f6')
    file = root / 'Captions' / f'{index:02}.png'
    image.save(file)
    timeline.extend([f"file '{file}'", 'option framerate 1000', f'duration {end - start:.6f}'])
timeline.extend([f"file '{file}'", 'option framerate 1000'])
(root / 'captions.concat').write_text('\n'.join(timeline) + '\n')

image = Image.new('RGB', (1440, 900), '#272a30')
draw = ImageDraw.Draw(image)
draw.text((80, 180), 'Viewer / Mounting job', font=ImageFont.truetype(FONT, 42), fill='#f2f4f6')
for y, line in zip([300, 345, 390, 435], [
    'Meta muse-spark-1.3 · Saved sessions, prompt excerpts and staged reveals',
    'Native Viewer controls · Local review corrections',
    'Fictional job and supplier · Temporary narration',
    'Robot assets: TheRobotStudio / SO-ARM100',
]):
    draw.text((80, y), line, font=ImageFont.truetype(FONT, 23), fill='#b1bac6')
image.save(root / 'credits.png')
run([FFMPEG, '-n', '-v', 'error', '-threads', '2', '-filter_threads', '2', '-loop', '1', '-i', str(root / 'credits.png'), '-t', str(duration - picture_end), '-r', '30', '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8000k', '-pix_fmt', 'yuv420p', str(root / 'credits.mp4')])
with (root / 'picture.concat').open('x') as text:
    for clip in capture['clips']:
        text.write(f"file '{clip['video']}'\n")
    text.write(f"file '{root / 'credits.mp4'}'\n")
output = root / 'Viewer - mounting workflow - review.mp4'
run([FFMPEG, '-n', '-v', 'error', '-threads', '2', '-filter_complex_threads', '2',
     '-f', 'concat', '-safe', '0', '-i', str(root / 'picture.concat'),
     '-f', 'concat', '-safe', '0', '-i', str(root / 'captions.concat'),
     '-i', str(root / 'narration.wav'), '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto[v]',
     '-map', '[v]', '-map', '2:a:0', '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8000k', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '160k', '-t', str(duration), '-movflags', '+faststart', str(output)])
store(root / 'script.json', {'source': str(source), 'duration': duration, 'pictureEnd': picture_end, 'cues': cues, 'clips': capture['clips'], 'providerRequests': 0})
run([FFMPEG, '-v', 'error', '-threads', '2', '-i', str(output), '-map', '0:v', '-map', '0:a', '-f', 'null', '-'])
info = probe(output)
assert abs(float(info['format']['duration']) - duration) < .1
samples = [2, 8, 10, 12, 14, 17, 21, 24, 29, 34, 36, 39, 42, 46]
files = []
for second in samples:
    if second >= duration: continue
    file = root / 'Review' / f'{second:02}.png'
    run([FFMPEG, '-n', '-v', 'error', '-threads', '2', '-ss', str(second), '-i', str(output), '-frames:v', '1', str(file)])
    files.append(file)
sheet = Image.new('RGB', (1440, math.ceil(len(files) / 3) * 320), '#15181d')
draw = ImageDraw.Draw(sheet)
for index, file in enumerate(files):
    thumbnail = Image.open(file); thumbnail.thumbnail((480, 300))
    x, y = index % 3 * 480, index // 3 * 320
    sheet.paste(thumbnail, (x, y)); draw.text((x + 8, y + 302), file.stem + ' seconds', fill='white')
sheet.save(root / 'Review/contact.png')
store(root / 'verification.json', {'status': 'technical-checks-passed', 'duration': duration,
    'sourceCapture': str(source), 'video': str(output), 'sha256': hashlib.file_digest(output.open('rb'), 'sha256').hexdigest(),
    'providerRequests': 0, 'voice': 'Temporary system voice', 'playbackSpeed': 1, 'inputs': sum(len(c['inputs']) for c in capture['clips'])})
print(json.dumps({'video': str(output), 'script': str(root / 'Narration.txt'), 'seconds': duration}), flush=True)
