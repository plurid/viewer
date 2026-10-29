import type { Sample } from '../types';
import { sample } from './documents';

const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', language: 'python', display_name: 'Python 3' } },
  cells: [
    {
      cell_type: 'markdown',
      metadata: {},
      source: ['# Field notes\n', 'Materials for the panel.'],
    },
    {
      cell_type: 'code',
      execution_count: 1,
      metadata: {},
      source: ['materials = {"Aluminum": 12, "Nylon": 24}\n', 'sum(materials.values())'],
      outputs: [
        {
          output_type: 'execute_result',
          execution_count: 1,
          metadata: {},
          data: { 'text/plain': ['36'] },
        },
      ],
    },
    {
      cell_type: 'code',
      execution_count: 2,
      metadata: {},
      source: ['print("Panel area:", 200 * 100)'],
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['Panel area: 20000\n'] }],
    },
  ],
};
const calendar = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Viewer playground//EN\r
BEGIN:VEVENT\r
UID:walk@example.org\r
DTSTAMP:20261029T090000Z\r
DTSTART:20261101T080000Z\r
DTEND:20261101T110000Z\r
SUMMARY:Morning walk\r
LOCATION:Riverside path\r
DESCRIPTION:Bring a camera\\, water and a little extra time.\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:picnic@example.org\r
DTSTAMP:20261029T090000Z\r
DTSTART;VALUE=DATE:20261102\r
SUMMARY:Picnic\r
END:VEVENT\r
END:VCALENDAR\r
`;
const contacts = `BEGIN:VCARD\r
VERSION:4.0\r
FN:Ada Field\r
N:Field;Ada;;;\r
ORG:Field notes\r
EMAIL;TYPE=work:ada@example.org\r
TEL;TYPE=cell:+1-555-0100\r
END:VCARD\r
BEGIN:VCARD\r
VERSION:3.0\r
FN:Sam Path\r
N:Path;Sam;;;\r
NOTE:Knows the riverside trail.\r
END:VCARD\r
`;
const subtitles = {
  srt: '1\n00:00:01,000 --> 00:00:03,500\nA short walk.\n\n2\n00:00:04,000 --> 00:00:06,000\nA few photographs.\n',
  vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nA short walk.\n\n00:00:04.000 --> 00:00:06.000\n<i>A few photographs.</i>\n',
  ass: `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment
Style: Default,Helvetica,40,&H00FFFFFF,0,0,2

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,A short walk.
Dialogue: 0,0:00:04.00,0:00:06.00,Default,{\\i1}A few photographs.{\\i0}
`,
};

/** Text files a module reads as a document: a notebook, calendar, contact cards and subtitles. */
export function structuredTextSamples(): Sample[] {
  return [
    sample(
      'previews/documents/Field notes.ipynb',
      ['ipynb'],
      'Notebook cells and outputs',
      'Markdown and two Python cells with their saved outputs; nothing runs.',
      JSON.stringify(notebook, null, 1) + '\n',
    ),
    ...['ics', 'ical'].map((format) =>
      sample(
        `previews/data/Trip.${format}`,
        [format],
        'Calendar events',
        'Two events, one all day.',
        calendar,
      ),
    ),
    ...['vcf', 'vcard'].map((format) =>
      sample(
        `previews/data/Friends.${format}`,
        [format],
        'Contact cards',
        'Two fictional contacts.',
        contacts,
      ),
    ),
    ...Object.entries(subtitles).map(([format, text]) =>
      sample(
        `previews/video/Motion study.${format}`,
        [format],
        'Subtitle cues',
        'Two timed cues.',
        text,
      ),
    ),
    sample(
      'previews/video/Motion study.en.srt',
      ['srt'],
      'Subtitle cues, and a track each Motion study video offers',
      'Two English cues within the two-second clips; its name gives the track its language.',
      [
        '1',
        '00:00:00,200 --> 00:00:01,000',
        'Shapes in motion.',
        '',
        '2',
        '00:00:01,000 --> 00:00:01,900',
        '<i>A second pass.</i>',
        '',
      ].join('\n'),
    ),
    sample(
      'previews/video/Motion study.ssa',
      ['ssa'],
      'Subtitle cues',
      'Two timed cues in the older SubStation form.',
      subtitles.ass
        .replace('ScriptType: v4.00+', 'ScriptType: v4.00')
        .replace('[V4+ Styles]', '[V4 Styles]'),
    ),
  ];
}
