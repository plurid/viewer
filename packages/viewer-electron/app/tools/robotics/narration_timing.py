"""Fit recorded narration to native actions while preserving every nonzero audio sample."""

import hashlib
import json
import re
import wave

import numpy as np


def seconds(value):
    hours, minutes, value = value.replace(',', '.').split(':')
    return int(hours) * 3600 + int(minutes) * 60 + float(value)


def words(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())


class RecordedNarration:
    def __init__(self, directory, original_script):
        self.directory = directory
        self.original_script = original_script
        self.captions = []
        for block in (directory / 'Captions.srt').read_text().strip().split('\n\n'):
            lines = block.splitlines()
            start, end = lines[1].split(' --> ')
            self.captions.append({'start': seconds(start), 'end': seconds(end),
                                  'text': '\n'.join(lines[2:])})
        self.groups = []
        index = 0
        for cue in json.loads(original_script.read_text())['cues']:
            first, text = index, ''
            while words(text) != words(cue['text']):
                assert index < len(self.captions) and words(cue['text']).startswith(words(text)), cue
                text += ' ' + self.captions[index]['text']
                index += 1
            self.groups.append({**cue, 'captions': self.captions[first:index]})
        assert index == len(self.captions), 'Every supplied caption must belong to a spoken passage.'
        comparison = next(group for group in self.groups if group.get('action') == 'comparison')
        assert words(comparison['captions'][-1]['text']) == words("I'll use the front.")
        index = self.groups.index(comparison)
        self.groups[index:index + 1] = [
            {**comparison, 'scriptText': comparison['text'],
             'text': ' '.join(c['text'].replace('\n', ' ') for c in comparison['captions'][:-1]),
             'captions': comparison['captions'][:-1]},
            {**comparison, 'action': 'choose-front', 'text': "I'll use the front.",
             'captions': comparison['captions'][-1:]},
        ]
        with wave.open(str(directory / 'Narration.wav')) as audio:
            assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
            self.rate = audio.getframerate()
            self.audio = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2')
        with (directory / 'Narration.wav').open('rb') as source:
            self.source_hash = hashlib.file_digest(source, 'sha256').hexdigest()

        # Allow quantization noise at boundaries; the reconstruction check still retains every sample.
        step = round(self.rate * .005)
        peak = np.max(np.abs(self.audio[:len(self.audio) // step * step].astype(np.int32)
                             .reshape(-1, step)), axis=1)
        quiet = peak <= 4
        edges = np.flatnonzero(np.diff(np.r_[False, quiet, False])).reshape(-1, 2)
        silences = [(a * step / self.rate, b * step / self.rate) for a, b in edges
                    if (b - a) * step / self.rate >= .08]
        boundaries = [0]
        for left, right in zip(self.groups, self.groups[1:]):
            end, start = left['captions'][-1]['end'], right['captions'][0]['start']
            target = (end + start) / 2
            choices = [(a, b) for a, b in silences if b >= end - .5 and a <= start + .3]
            assert choices, ('No silent boundary between passages', left['text'], right['text'])
            a, b = min(choices, key=lambda pair: abs((pair[0] + pair[1]) / 2 - target))
            boundaries.append(round((a + b) / 2 * self.rate))
        boundaries.append(len(self.audio))
        restored = np.zeros_like(self.audio)
        for index, group in enumerate(self.groups):
            a, b = boundaries[index:index + 2]
            active = np.flatnonzero(self.audio[a:b])
            assert len(active), group['text']
            first, last = a + int(active[0]), a + int(active[-1]) + 1
            spoken = np.flatnonzero(np.abs(self.audio[a:b].astype(np.int32)) > 16)
            assert len(spoken), group['text']
            start, end = max(a, first - round(self.rate * .08)), min(b, last + round(self.rate * .12))
            group.update({'sourceStart': start / self.rate, 'sourceEnd': end / self.rate,
                          'sampleStart': start, 'sampleEnd': end,
                          'speechStart': (a + int(spoken[0])) / self.rate,
                          'speechEnd': (a + int(spoken[-1]) + 1) / self.rate,
                          'seconds': (end - start) / self.rate})
            restored[start:end] = self.audio[start:end]
        assert np.array_equal(restored, self.audio), 'Never discard recorded speech or room tone.'
        self.actions = {group['action']: group for group in self.groups if group.get('action')}
        self.placements = []
        self.trimmed = []

    def ranges(self, clip, edit_time):
        """Only trim recorded idle tails after work ends; retain inputs, reads and camera moves."""
        marks = clip['marks']
        result = []
        if marks[0]['seconds'] > 0:
            result.append({'start': 0, 'end': marks[0]['seconds'], 'padding': 0})
        for index, mark in enumerate(marks):
            start = mark['seconds']
            end = marks[index + 1]['seconds'] if index + 1 < len(marks) else clip['seconds']
            assert start <= mark['workEnd'] <= end, 'Narrated edits need captured action completion.'
            group = self.actions.get(mark['action']) if mark['narration'] else None
            lead = {'browser': -.55, 'editor': -.55, 'terminal': -.55, 'save-check': .6,
                    'reopen': -1.2, 'ask-meta': 1.25, 'changed-constraint': .75,
                    'quote': .75}.get(mark['action'], .25)
            desired = edit_time(clip, mark['workEnd']) + .35
            if group:
                assert group.get('scriptText', group['text']) == mark['narration']
                if mark['action'] == 'save-check':
                    assert marks[index + 1]['action'] == 'export-tool'
                else:
                    desired = max(desired, edit_time(clip, start) + lead + group['seconds'] + .4)
            native_end = edit_time(clip, end)
            if not group:
                desired = min(desired, native_end)
            padding = max(0, desired - native_end)
            kept_end = end
            if desired < native_end:
                low, high = mark['workEnd'], end
                for _ in range(40):
                    middle = (low + high) / 2
                    if edit_time(clip, middle) < desired:
                        low = middle
                    else:
                        high = middle
                kept_end = high
            result.append({'start': start, 'end': kept_end, 'padding': padding,
                           'mark': mark, 'lead': lead, 'group': group})
            if end - kept_end > .01:
                self.trimmed.append({'clip': clip['name'], 'action': mark['action'],
                                     'sourceStart': kept_end, 'sourceEnd': end,
                                     'seconds': native_end - edit_time(clip, kept_end)})
        for item in clip['inputs']:
            at = item['milliseconds'] / 1000
            assert any(r['start'] <= at <= r['end'] for r in result), ('Would cut input', item)
        for span in [*clip.get('cameraMotion', []), *clip.get('commandReads', [])]:
            assert any(r['start'] <= span['start'] and span['end'] <= r['end'] for r in result), span
        return result

    def place(self, group, start):
        assert start >= 0
        end = start + group['seconds']
        if self.placements:
            assert start >= self.placements[-1]['end'], ('Overlapping voice passages', group['text'])
        self.placements.append({'group': group, 'start': start, 'end': end})
        return {'start': start, 'end': end, 'text': group['text'],
                **({'action': group['action']} if group.get('action') else {'opening': True})}

    def write(self, root, duration):
        assert len(self.placements) == len(self.groups)
        mixed = np.zeros(round(duration * self.rate), dtype='<i2')
        captions = []
        for place in self.placements:
            group = place['group']
            chunk = self.audio[group['sampleStart']:group['sampleEnd']]
            start = round(place['start'] * self.rate)
            assert start + len(chunk) <= len(mixed)
            mixed[start:start + len(chunk)] = chunk
            # Keep the approved caption wording, anchoring its first/last edges to the PCM passage.
            a, b = group['captions'][0]['start'], group['captions'][-1]['end']
            scale = (group['speechEnd'] - group['speechStart']) / (b - a)
            offset = place['start'] + group['speechStart'] - group['sourceStart']
            for caption in group['captions']:
                captions.append({'start': offset + (caption['start'] - a) * scale,
                                 'end': offset + (caption['end'] - a) * scale,
                                 'text': caption['text']})
        with wave.open(str(root / 'narration.wav'), 'wb') as output:
            output.setparams((1, 2, self.rate, 0, 'NONE', 'not compressed'))
            output.writeframes(mixed.tobytes())
        for place in self.placements:
            group = place['group']
            start = round(place['start'] * self.rate)
            chunk = self.audio[group['sampleStart']:group['sampleEnd']]
            assert np.array_equal(mixed[start:start + len(chunk)], chunk)
        return captions

    def evidence(self):
        gaps = [{'after': a['group'].get('action', 'opening'), 'seconds': b['start'] - a['end']}
                for a, b in zip(self.placements, self.placements[1:])]
        return {'sourceAudio': str(self.directory / 'Narration.wav'),
                'sourceScript': str(self.original_script), 'sourceAudioSha256': self.source_hash,
                'voiceSpeed': 1, 'allNonzeroSamplesPreserved': True,
                'trimmedIdle': self.trimmed, 'gaps': gaps,
                'passages': [{'text': p['group']['text'], 'action': p['group'].get('action'),
                              'sourceStart': p['group']['sourceStart'],
                              'sourceEnd': p['group']['sourceEnd'],
                              'start': p['start'], 'end': p['end']} for p in self.placements]}
