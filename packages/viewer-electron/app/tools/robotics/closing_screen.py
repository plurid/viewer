"""The film's editorial request, product signature and hackathon feature roll."""

import math

from PIL import Image, ImageDraw, ImageFont


SECONDS = 8
SIZE = (2880, 1800)
BACKGROUND = '#20242b'
FONT = '/System/Library/Fonts/SFNS.ttf'

# Product additions and extensions recorded in docs/release/hackathon-contributions.md.
# Requested editors are the closing draft, not claims that those editors have been generated.
FEATURE_ROWS = (
    ('Agent canvases', 'Meta tool calls', 'Shared tool actions', 'Human takeover',
     'Saved inputs', 'Tool revisions'),
    ('Quote branches', 'Independent alternatives', 'Source snapshots', 'Refreshable context',
     'Build tool from selection', 'Runtime feedback'),
    ('Tool library', 'Duplicate tools', 'Enable / disable tools', 'Portable tools',
     'Offline reopening', 'Review before saving'),
    ('CSV & JSON export', 'Text & Markdown export', 'DXF export', 'Robotics plugin',
     'Quick shell commands', 'Viewer file dialogs', 'Context links'),
    ('Camera anchors', 'Camera tours', 'Pinned planes', 'Stacked planes',
     'Arrangement history', 'Occlusion fading', 'Title-bar selection'),
)


def font(size, weight=400):
    face = ImageFont.truetype(FONT, size)
    face.set_variation_by_axes([100, min(96, size), 400, weight])
    return face


def request_edits():
    """Type the request, then replace only its noun and the article when needed."""
    prompt = 'I need an image editor'
    edits = [(0, '', 0)]
    for count in range(1, len(prompt) + 1):
        edits.append((.18 + count * .065, prompt[:count], count))
    prefix, suffix = 'I need an ', ' editor'
    edits.append((2.3, prompt, len(prefix + 'image')))
    for count in range(4, -1, -1):
        edits.append((2.42 + (4 - count) * .055,
                      prefix + 'image'[:count] + suffix, len(prefix) + count))
    prefix = 'I need a '
    edits.append((2.72, prefix + suffix, len(prefix)))
    for count in range(1, 6):
        edits.append((2.8 + count * .075, prefix + 'video'[:count] + suffix, len(prefix) + count))
    prompt = prefix + 'video' + suffix
    edits.append((3.3, prompt, len(prompt)))
    edits.append((4.25, prompt, len(prefix + 'video')))
    for count in range(4, -1, -1):
        edits.append((4.37 + (4 - count) * .055,
                      prefix + 'video'[:count] + suffix, len(prefix) + count))
    for count in range(1, 5):
        edits.append((4.7 + count * .08, prefix + 'file'[:count] + suffix, len(prefix) + count))
    prompt = prefix + 'file' + suffix
    edits.append((5.15, prompt, len(prompt)))
    assert all(a[0] < b[0] for a, b in zip(edits, edits[1:]))
    assert all(0 <= caret <= len(text) for _, text, caret in edits)
    return edits


class ClosingScreen:
    """Render at the delivery resolution, caching the fixed type and pill artwork."""

    def __init__(self):
        self.edits = request_edits()
        self.prompt_font = font(82, 450)
        self.plate = Image.new('RGB', SIZE, BACKGROUND)
        draw = ImageDraw.Draw(self.plate)
        draw.text((1440, 650), 'Viewer', anchor='mm', font=font(236, 650), fill='#f6f8fa')
        draw.text((1440, 835), 'a plurid technology', anchor='mm',
                  font=font(54, 400), fill='#bdcbd7')
        draw.text((1440, 1035), 'Built during the hackathon', anchor='mm',
                  font=font(36, 500), fill='#bdcbd7')
        self.rows = []
        pill_font = font(43, 500)
        for row, labels in enumerate(FEATURE_ROWS):
            widths = [math.ceil(draw.textlength(label, font=pill_font)) + 84 for label in labels]
            length = sum(widths) + 24 * len(widths)
            strip = Image.new('RGB', (length, 92), BACKGROUND)
            pen = ImageDraw.Draw(strip)
            offset = 0
            boxes = []
            for index, (label, width) in enumerate(zip(labels, widths)):
                accent = (index + row * 2) % 5 == 0
                pen.rounded_rectangle((offset, 0, offset + width, 91), radius=46,
                                      fill='#bed6e8' if accent else '#323b46')
                pen.text((offset + width / 2, 46), label, anchor='mm', font=pill_font,
                         fill='#1b2934' if accent else '#edf2f7')
                boxes.append({'label': label, 'start': offset, 'width': width})
                offset += width + 24
            # Every label crosses the fully legible centre at least once, at a steady reading pace.
            distance = max(400, length - (SIZE[0] - 360))
            self.rows.append({'image': strip, 'length': length, 'distance': distance,
                              'direction': -1 if row % 2 == 0 else 1, 'boxes': boxes})
        self.fade = Image.new('L', (SIZE[0], 1))
        self.fade.putdata([round(255 * min(1, x / 180, (SIZE[0] - 1 - x) / 180))
                           for x in range(SIZE[0])])
        self.fade = self.fade.resize((SIZE[0], 92))

    def row_origin(self, row, seconds):
        progress = min(1, max(0, (seconds - 1.6) / 4.8))
        distance = row['distance'] * progress * progress * (3 - 2 * progress)
        origin = 180 if row['direction'] < 0 else SIZE[0] - 180 - row['length']
        return origin + row['direction'] * distance

    def frame(self, seconds):
        image = self.plate.copy()
        draw = ImageDraw.Draw(image)
        changed, text, caret = next(edit for edit in reversed(self.edits) if edit[0] <= seconds)
        prompt_width = draw.textlength('I need an image editor', font=self.prompt_font)
        left = (SIZE[0] - prompt_width) / 2
        draw.text((left, 298), text, anchor='lm', font=self.prompt_font, fill='#f1f5f8')
        if int((seconds - changed) / .5) % 2 == 0:
            x = left + draw.textlength(text[:caret], font=self.prompt_font) + 3
            draw.line((x, 256, x, 342), fill='#bed6e8', width=3)
        for index, row in enumerate(self.rows):
            band = Image.new('RGB', (SIZE[0], 92), BACKGROUND)
            origin = self.row_origin(row, seconds)
            first = math.floor(-origin / row['length'])
            for repeat in range(first, first + 3):
                band.paste(row['image'], (round(origin + repeat * row['length']), 0))
            image.paste(band, (0, 1120 + index * 118), self.fade)
        return image

    def evidence(self):
        # Retain readable exposure, not just presence somewhere in the moving strip.
        exposure = {}
        for row in self.rows:
            for box in row['boxes']:
                frames = 0
                for tick in range(SECONDS * 30):
                    x = self.row_origin(row, tick / 30) + box['start']
                    if any(180 <= x + repeat * row['length'] and
                           x + repeat * row['length'] + box['width'] <= SIZE[0] - 180
                           for repeat in (-1, 0, 1)):
                        frames += 1
                exposure[box['label']] = frames / 30
        assert min(exposure.values()) >= 1.5, exposure
        return {'brand': 'Viewer', 'byline': 'a plurid technology',
                'featureRows': FEATURE_ROWS, 'fullyVisibleSeconds': exposure,
                'requestedEditors': ['image', 'video', 'file']}
