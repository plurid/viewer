"""Encode a native story capture with separate captions and optional temporary narration."""

import argparse
import hashlib
import json
import math
import pathlib
import struct
import subprocess
import tempfile
import textwrap
import wave

from PIL import Image, ImageDraw, ImageFont

from closing_screen import ClosingScreen, SECONDS as CLOSING_SECONDS

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


arguments = argparse.ArgumentParser()
arguments.add_argument('capture', type=pathlib.Path)
arguments.add_argument('--clean', action='store_true')
arguments.add_argument('--narration', type=pathlib.Path)
arguments.add_argument('--timing-from', type=pathlib.Path)
options = arguments.parse_args()
source = options.capture.resolve()
clean = options.clean
recorded = None
if options.narration:
    assert options.timing_from and not clean
    from narration_timing import RecordedNarration
    recorded = RecordedNarration(options.narration, options.timing_from)
else:
    assert not options.timing_from, '--timing-from requires --narration'
assert json.loads((source / 'story-completed.json').read_text())['status'] == 'passed'
capture = json.loads((source / 'story-capture.json').read_text())
plugin = capture.get('film') == 'plugin'
station = capture.get('film') in ('station', 'plugin')
continuous_navigation = capture.get('continuousNavigation', False)
camera_time_scale = capture.get('cameraTimeScale', 1)
staged_canvas_arrival = capture.get('stagedCanvasArrival', False)
assert 1 <= camera_time_scale <= 2, 'Keep camera retiming bounded.'


def edit_time(clip, seconds):
    """Slow only observed camera intervals; working controls keep their captured timing."""
    return seconds + sum(max(0, min(seconds, move['end']) - move['start'])
                         * (camera_time_scale - 1) for move in clip.get('cameraMotion', []))


for clip in capture['clips']:
    previous = 0
    for move in clip.get('cameraMotion', []):
        assert previous <= move['start'] < move['end'] <= clip['seconds']
        previous = move['end']
if camera_time_scale != 1:
    assert any(clip.get('cameraMotion') for clip in capture['clips']), 'Camera retiming needs observed motion.'
if staged_canvas_arrival:
    arrivals = [event for item in capture['evidence'] for event in item.get('presentation', [])
                if event['kind'].startswith('canvas-arrival-')]
    assert [event['kind'] for event in arrivals] == ['canvas-arrival-start', 'canvas-arrival-complete']
    assert arrivals[0]['milliseconds'] < arrivals[1]['milliseconds']
if continuous_navigation:
    assert not any(clip.get('omitActions') for clip in capture['clips']), 'Keep every navigation action.'
    for clip in capture['clips']:
        for move in clip.get('navigation', []):
            assert 0 <= move['start'] <= move['settled'] < move['end'] <= clip['seconds']
            assert move['end'] - move['settled'] >= .5, 'Hold the view after arriving.'
assert capture['providerRequests'] == 0 and len(capture['clips']) in ((11,) if station else (8, 9))
closing_callback = capture['clips'][-1]['name'] == '08-closing'
closing_prompt = plugin and not closing_callback
assert not recorded or closing_prompt, 'Recorded narration currently targets the qualified plugin film.'
assert (capture['width'], capture['height']) == SIZE
root = pathlib.Path(tempfile.mkdtemp(prefix='viewer-interface-review-', dir='/private/tmp'))
for name in ['Voice', 'Captions', 'Review', 'Closing']:
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
    if recorded:
        group = recorded.groups[index]
        assert group['text'] == text
        slots.append(recorded.place(group, group['sourceStart']))
    else:
        slots.append({'start': start, 'end': end, 'text': text, 'opening': True})

cursor = opening[-1][1]
samples = []
source_frames = 0
command_reads = []
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
        verify_png(directory / frame['file'])
    assert previous / 1000 <= clip['seconds']
    keep_from = 0
    ranges = []
    omissions = set(clip.get('omitActions', []))
    assert omissions <= {mark['action'] for mark in clip['marks']}
    for index, mark in enumerate(clip['marks']):
        if mark['action'] not in omissions:
            continue
        if mark['seconds'] > keep_from:
            ranges.append((keep_from, mark['seconds']))
        keep_from = clip['marks'][index + 1]['seconds'] if index + 1 < len(clip['marks']) else clip['seconds']
    if keep_from < clip['seconds']:
        ranges.append((keep_from, clip['seconds']))
    segments = (recorded.ranges(clip, edit_time) if recorded else
                [{'start': start, 'end': end, 'padding': 0} for start, end in ranges])
    clip['editStart'] = cursor
    clip['selectedRanges'] = []
    included = set()
    for segment in segments:
        start, end, padding = segment['start'], segment['end'], segment['padding']
        assert 0 <= start < end <= clip['seconds']
        clip['selectedRanges'].append({'sourceStart': start, 'sourceEnd': end, 'editStart': cursor,
                                      'editEnd': cursor + edit_time(clip, end) - edit_time(clip, start) + padding,
                                      'tailHold': padding})
        selected_seconds = 0
        for index, frame in enumerate(frames):
            frame_start = frames[index]['milliseconds'] / 1000 if index else 0
            frame_end = frames[index + 1]['milliseconds'] / 1000 if index + 1 < len(frames) else clip['seconds']
            kept_start, kept_end = max(start, frame_start), min(end, frame_end)
            if kept_end <= kept_start:
                continue
            length = edit_time(clip, kept_end) - edit_time(clip, kept_start)
            last_file = directory / frame['file']
            picture.extend(concat_entry(last_file, length))
            included.add(index)
            selected_seconds += length
        assert abs(selected_seconds - (edit_time(clip, end) - edit_time(clip, start))) < .000001
        if padding:
            picture.extend(concat_entry(last_file, padding))
        if recorded:
            if clip['name'] == '10-handoff' and start == 0:
                at = clip['commandReads'][0]['end']
                slots.append(recorded.place(recorded.actions['choose-front'], cursor + edit_time(clip, at)))
            if segment.get('group'):
                slots.append(recorded.place(segment['group'], cursor + segment['lead']))
        for read in clip.get('commandReads', []):
            if start <= read['start'] and read['end'] <= end:
                first = cursor + edit_time(clip, read['start']) - edit_time(clip, start)
                last = cursor + edit_time(clip, read['end']) - edit_time(clip, start)
                assert 1.5 <= last - first < 2
                command_reads.append({'command': read['command'], 'start': first, 'end': last})
                samples.append({'time': (first + last) / 2, 'action': 'read-command'})
        for index, mark in enumerate(clip['marks']):
            mark_end = clip['marks'][index + 1]['seconds'] if index + 1 < len(clip['marks']) else clip['seconds']
            if not start <= mark['seconds'] < end:
                continue
            available = edit_time(clip, min(mark_end, end)) - edit_time(clip, mark['seconds'])
            offset = cursor + edit_time(clip, mark['seconds']) - edit_time(clip, start)
            if mark['narration'] and not recorded:
                assert mark_end <= end, 'Never cut off a spoken cue.'
                slots.append({'start': offset, 'end': offset + available,
                              'text': mark['narration'], 'action': mark['action']})
            samples.append({'time': offset + min(3, available * .6), 'action': mark['action']})
        cursor += edit_time(clip, end) - edit_time(clip, start) + padding
    source_frames += len(included)
    clip['editEnd'] = cursor

picture_end = cursor
duration = math.ceil((picture_end + (CLOSING_SECONDS if closing_prompt else 7)) * 30) / 30
assert duration <= 180, ('Keep the full cut under three minutes', duration)
credits = [
    'Viewer + Plurid: existing projects',
    'Hackathon: generated canvases, revisions, saved inputs and source-based checks',
    'Meta muse-spark-1.3 · Robot: TheRobotStudio / SO-ARM100',
    ('Saved responses · Condensed repairs · Local layout, replay repair and measurement labels · Edited navigation and reveals'
     if closing_callback else 'Saved responses · Condensed repairs · Staged reveals and local layout refinements'),
    'Temporary opening and voice · Kinematic endpoints, no path or hardware simulation',
]
if station:
    credits = [
        'Viewer + Plurid: existing projects',
        'Hackathon: generated tools, agent actions, quoted branches and independent checks',
        'Meta muse-spark-1.3 · Robot: TheRobotStudio / SO-ARM100',
        'Saved Meta responses · Condensed repairs · Local presentation edits and staged reveals',
        'Fictional station · Endpoint checks · Temporary opening and voice',
    ]
if plugin:
    credits = [
        'Viewer + Plurid: existing projects',
        'Hackathon: agent canvases, actions, quoted branches and tool management',
        'Meta muse-spark-1.3: interface edits and decisions · Reused robotics plugin',
        'Saved Meta responses · Repairs condensed · First turn has no closing reply',
        'SO-ARM100 / TheRobotStudio · Fictional station · Temporary opening and voice',
    ]
    if camera_time_scale != 1:
        credits[3] = 'Saved Meta responses · Repairs condensed · Camera moves slowed for readability'
    if staged_canvas_arrival:
        credits[3] = 'Saved Meta responses · Condensed repairs · Staged entrance · Slower camera moves'
if clean:
    credits = [credit.replace('Temporary opening and voice', 'Temporary opening') for credit in credits]
if recorded:
    credits = [credit.replace('Temporary opening and voice', 'Temporary opening') for credit in credits]
    credits.append('Supplied recorded narration · Idle tails trimmed · Command selections held for 1.5 seconds')
on_screen_credits = [] if clean or closing_prompt else credits
closing_prompt_evidence = None
if closing_prompt:
    screen = ClosingScreen()
    outro_seconds = duration - picture_end
    for index in range(math.ceil(outro_seconds * 30)):
        seconds = index / 30
        file = root / 'Closing' / f'{index:03}.png'
        screen.frame(seconds).save(file)
        picture.extend(concat_entry(file, min(1 / 30, outro_seconds - seconds)))
    closing_prompt_evidence = {
        'start': picture_end, 'end': duration, 'editorial': True, 'submitted': False,
        'edits': [{'seconds': at, 'text': text, 'caret': caret} for at, text, caret in screen.edits],
        'presentation': screen.evidence(),
    }
    samples.extend([{'time': picture_end + 1.9, 'action': 'closing-image-editor'},
                    {'time': picture_end + 3.7, 'action': 'closing-video-editor'},
                    {'time': picture_end + 6.3, 'action': 'closing-file-editor'},
                    {'time': picture_end + 7.8, 'action': 'closing-features'}])
elif closing_callback:
    for index, text in enumerate(['There is no interface.', 'Until you need one.']):
        image = Image.new('RGB', SIZE, '#22262c')
        draw = ImageDraw.Draw(image)
        draw.text((1440, 690), 'There is no interface.', anchor='mm',
                  font=ImageFont.truetype(FONT, 88), fill='#f3f4f6')
        if index:
            draw.text((1440, 810), text, anchor='mm',
                      font=ImageFont.truetype(FONT, 68), fill='#f3f4f6')
        draw.text((1440, 1050), 'Viewer / Plurid', anchor='mm',
                  font=ImageFont.truetype(FONT, 36), fill='#b8c0cc')
        for row, credit in enumerate(on_screen_credits):
            draw.text((1440, 1440 + row * 48), credit, anchor='mm',
                      font=ImageFont.truetype(FONT, 28), fill='#b8c0cc')
        file = root / f'closing-{index}.png'
        image.save(file)
        start = picture_end + (3 if index else 0)
        end = duration if index else picture_end + 3
        picture.extend(concat_entry(file, end - start))
        slots.append({'start': start, 'end': end, 'text': text, 'opening': True})
    samples.append({'time': picture_end + 4, 'action': 'final-title'})
else:
    image = Image.new('RGB', SIZE, '#22262c')
    draw = ImageDraw.Draw(image)
    draw.text((160, 380), 'Viewer / There Is No Interface', font=ImageFont.truetype(FONT, 76), fill='#f3f4f6')
    for index, text in enumerate(on_screen_credits):
        draw.text((160, 580 + index * 88), text, font=ImageFont.truetype(FONT, 34), fill='#b8c0cc')
    file = root / 'credits.png'
    image.save(file)
    picture.extend(concat_entry(file, duration - picture_end))
picture.extend(concat_entry(file, .001)[:2])
(root / 'picture.concat').write_text('\n'.join(picture) + '\n')

if recorded:
    cues = slots
    subtitle_cues = recorded.write(root, duration)
else:
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
    subtitle_cues = cues
with (root / 'Narration.txt').open('x') as text:
    text.write('THERE IS NO INTERFACE / NARRATION SCRIPT\n\n' +
               ('Silent video. Timings are a recording guide based on temporary narration.\n\n' if clean else
                ('Exact supplied narration, edited to the native actions without changing voice speed.\n\n' if recorded else
                 'Exact narration of this review cut. Temporary system voice: Daniel.\n\n')))
    for cue in cues:
        text.write(f"{stamp(cue['start'])} - {stamp(cue['end'])}\n{cue['text']}\n\n")
with (root / 'Captions.srt').open('x') as text:
    for index, cue in enumerate(subtitle_cues):
        text.write(f"{index + 1}\n{stamp(cue['start'], True)} --> {stamp(cue['end'], True)}\n{cue['text']}\n\n")

if station:
    directions = {
        'personal': 'Open the robot definition in a linked plane, then return to the project.',
        'project-thinking': 'Expand the mesh folder and open the linked arm geometry.',
        'browser': 'Pull back through the workspace, focus the project brief and let the browser plane settle.',
        'editor': 'Move through the workspace to the source definition, then use Command+E to edit it.',
        'terminal': 'Move through the workspace to the terminal and run ls after arriving.',
        'keynote': 'Frame all planes to reveal the shared spatial workspace.',
        'foundations': 'Move from the workspace into the actual Viewer conversation.',
        'ask-meta': 'Type the retained request, send it and open the generated canvas.',
        'tool-appears': 'Reveal the actual station view and working controls.',
        'model-evaluates': 'The activity row names Meta. Show the independently recomputed report.',
        'central-result': 'The operator selects Central, inspects a target and checks the saved selection.',
        'changed-constraint': 'Return to the same conversation and type the reserved-area request.',
        'meta-revises': 'The revised tool adds the restriction. Meta evaluates and selects Front.',
        'front-result': 'Read the checked candidate values and the Front recommendation.',
        'quote': 'Select the actual recommendation and open its quote branch in a new plane.',
        'comparison': 'Meta selects Rear. Show the independent comparison and movement distances.',
        'save-check': 'Save the check through Viewer\'s file picker, then export the tool.',
        'reopen': 'Reopen the exported tool and inspect another target using its controls.',
        'ending': 'Hold the reopened Front tool, then pull back into the project before the title.',
    }
    if plugin:
        directions.update({
            'existing-plugin': 'Open the existing robotics plugin and orbit its model before requesting an edit.',
            'ask-meta': 'Type an exact retained request excerpt and open the revised plugin.' +
                        (' Its real viewport and controls arrive from either side, then settle before use.'
                         if staged_canvas_arrival else ''),
            'model-evaluates': 'Meta invokes the plugin evaluation and selects Central. The activity row names its actor.',
            'central-result': 'Click the new target table and inspect the measured pose in the viewport.',
            'changed-constraint': 'Finish the first saved turn, then type the retained reserved-area request.',
            'meta-revises': 'The plugin shows the restriction explanation. Meta evaluates and selects Front.',
            'comparison': 'Meta invokes the plugin checks and selects Rear in the quoted alternative.',
            'choose-front': 'Return from the alternative to the Front tool through the workspace.',
            'save-check': 'Save the plugin result through the Viewer file picker, then export the tool.',
            'reopen': 'Reopen the unchanged exported plugin and use its target table.',
            'ending-origin': 'Use the new target controls in the reopened tool and watch the arm adopt that pose.',
            'manage-tools': 'Open the Tool library and show the saved tool controls.',
            'ending': 'Pull back to the connected project, tools and alternative, then hold as the narration finishes.',
        })
    prompt_by_action = dict(zip(['ask-meta', 'changed-constraint', 'quote'], capture['prompts']))
    with (root / 'Script.md').open('x') as text:
        text.write('# There Is No Interface\n\n' +
                   ('Narration and shot script for the silent cut. The video has no audio or burned-in subtitles. '
                    'SRT timings use temporary narration as a recording guide. ' if clean else
                    ('Exact script of the supplied narration, paced to native actions. Temporary opening. ' if recorded else
                     'Exact script of this review cut. Temporary opening and system voice. ')) +
                   'The product footage replays retained Meta responses through working Viewer actions; '
                   + (f'repair rounds are condensed and camera moves take {camera_time_scale:g} times their recorded duration. '
                      'Tool interactions play at their recorded speed.\n\n' if camera_time_scale != 1 else
                      ('repair rounds are condensed and spatial navigation plays continuously at its recorded speed.\n\n'
                       if continuous_navigation else 'repairs and navigation are condensed.\n\n')))
        if staged_canvas_arrival:
            text.write('The revised interface has one staged spatial entrance; its code and controls are unchanged.\n\n')
        if recorded:
            text.write('The supplied voice keeps its recorded speed. Idle tails after completed actions are trimmed; '
                       'every input and camera move remains. Command selections hold for 1.5 seconds before execution. '
                       'Captions are supplied as a separate SRT. The video has no embedded or burned-in subtitles.\n\n')
        for cue in cues:
            text.write(f"## {stamp(cue['start'])} to {stamp(cue['end'])}\n\n> {cue['text']}\n\n")
            action = cue.get('action')
            text.write('Picture: ' + directions.get(action, 'Opening title study.') + '\n\n')
            if action in prompt_by_action:
                text.write('Typed request:\n\n> ' + prompt_by_action[action]['text'] + '\n\n')
        if closing_prompt_evidence:
            text.write(f'## {stamp(picture_end)} to {stamp(duration)}\n\n'
                       'On screen: a centered request types “I need an image editor”, '
                       'replaces “image” with “video” and changes “an” to “a”, '
                       'then replaces “video” with “file”. The final request holds with a blinking caret. '
                       'A large Viewer title sits above “a plurid technology”. '
                       'Under “Built during the hackathon”, five rows of feature pills scroll in alternating directions. '
                       'This is an editorial closing sequence; the request is not submitted. '
                       'Production notes remain in this script. No additional narration.\n\n')
        text.write(('## Production notes (not on screen)\n\n' if not on_screen_credits else '## Credits\n\n') +
                   '\n'.join('- ' + credit for credit in credits) + '\n')

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
                            'cues': cues, 'clips': capture['clips'], 'providerRequests': 0,
                            'cameraTimeScale': camera_time_scale, 'stagedCanvasArrival': staged_canvas_arrival,
                            'closingPrompt': closing_prompt_evidence, 'cleanExport': clean,
                            'creditsInVideo': bool(on_screen_credits), 'commandReads': command_reads,
                            'recordedNarration': recorded.evidence() if recorded else None})

output = root / ('Viewer - Narration paced.mp4' if recorded else
                 'Viewer - Clean footage.mp4' if clean else 'Viewer - There Is No Interface - review.mp4')
print(json.dumps({'encoding': str(output), 'seconds': duration, 'nativeFrames': source_frames}), flush=True)
composition = ['-vf', 'fps=30', '-map', '0:v', '-an'] if clean else [
    '-f', 'concat', '-safe', '0', '-i', str(root / 'captions.concat'),
    '-i', str(root / 'narration.wav'),
    '-filter_complex', '[0:v]fps=30[base];[base][1:v]overlay=0:0:format=auto[v]',
    '-map', '[v]', '-map', '2:a:0', '-c:a', 'aac', '-b:a', '160k',
]
if recorded:
    composition = [
        '-i', str(root / 'narration.wav'),
        '-vf', 'fps=30', '-map', '0:v', '-map', '1:a',
        '-c:a', 'aac', '-b:a', '192k',
    ]
run([FFMPEG, '-n', '-v', 'warning', '-threads', '2', '-filter_complex_threads', '2',
     '-f', 'concat', '-safe', '0', '-i', str(root / 'picture.concat'),
     *composition, '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
     '-threads', '2', '-pix_fmt', 'yuv420p',
     '-t', str(duration), '-movflags', '+faststart', str(output)], timeout=900)
run([FFMPEG, '-v', 'error', '-threads', '2', '-i', str(output),
     '-map', '0:v', '-map', '0:a?', '-f', 'null', '-'], timeout=240)
info = probe(output)
stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
assert not clean or len(info['streams']) == 1, 'The clean export must contain only video.'
assert clean or any(s['codec_type'] == 'audio' for s in info['streams'])
assert not recorded or not any(s['codec_type'] == 'subtitle' for s in info['streams'])
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
      'providerRequests': 0, 'voice': 'Supplied recorded narration' if recorded else 'None' if clean else 'Temporary system voice',
      'audioIncluded': not clean, 'burnedInSubtitles': not clean and not bool(recorded),
      'recordedNarration': recorded.evidence() if recorded else None, 'commandReads': command_reads,
      'creditsInVideo': bool(on_screen_credits), 'interactionPlaybackSpeed': 1,
      'cameraTimeScale': camera_time_scale,
      'stagedCanvasArrival': staged_canvas_arrival,
      'closingPrompt': closing_prompt_evidence,
      'observedCameraMoves': sum(len(c.get('cameraMotion', [])) for c in capture['clips']),
      'continuousNavigation': continuous_navigation,
      'recordedNavigation': sum(len(c.get('navigation', [])) for c in capture['clips']),
      'reusedOpening': capture.get('reusedOpening'),
      'navigationEdits': [{'clip': c['name'], 'ranges': c['selectedRanges']}
                          for c in capture['clips'] if c.get('omitActions')],
      'inputs': sum(len(c['inputs']) for c in capture['clips'])})
print(json.dumps({'video': str(output), 'script': str(root / 'Narration.txt'), 'seconds': duration}), flush=True)
