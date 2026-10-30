import type { Sample } from '../types';
import { sample } from './documents';

type PlistValue = string | number | boolean | Uint8Array | PlistValue[] | PlistDictionary;
interface PlistDictionary {
  [key: string]: PlistValue;
}

const isDictionary = (value: PlistValue): value is PlistDictionary =>
  typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);
const unsigned = (value: number, size: number) =>
  Array.from({ length: size }, (_, index) => Math.floor(value / 256 ** (size - 1 - index)) % 256);
const sizeOf = (value: number) => (value < 256 ? 1 : value < 65536 ? 2 : value < 2 ** 32 ? 4 : 8);

/** A binary property list, as Safari writes a web archive: each dictionary's keys follow it, then
 * its values. Strings, non-negative integers, booleans, data, arrays and dictionaries. */
export function binaryPlist(top: PlistValue): Uint8Array {
  const objects: PlistValue[] = [];
  const children: number[][] = [];
  const add = (value: PlistValue): number => {
    const index = objects.push(value) - 1;
    children.push([]);
    if (Array.isArray(value)) children[index] = value.map(add);
    else if (isDictionary(value)) {
      const keys = Object.keys(value);
      const references = keys.map(add);
      children[index] = [...references, ...keys.map((key) => add(value[key]!))];
    }
    return index;
  };
  add(top);
  const reference = sizeOf(objects.length);
  const bytes: number[] = [...'bplist00'].map((character) => character.charCodeAt(0));
  const marker = (type: number, length: number) =>
    length < 15
      ? [(type << 4) | length]
      : [(type << 4) | 15, 0x10 | Math.log2(sizeOf(length)), ...unsigned(length, sizeOf(length))];
  const offsets = objects.map((value, index) => {
    const at = bytes.length;
    let encoded: number[];
    if (typeof value === 'boolean') encoded = [value ? 0x09 : 0x08];
    else if (typeof value === 'number')
      encoded = [0x10 | Math.log2(sizeOf(value)), ...unsigned(value, sizeOf(value))];
    else if (typeof value === 'string') {
      const ascii = /^[\x00-\x7f]*$/.test(value);
      encoded = ascii
        ? [...marker(5, value.length), ...[...value].map((character) => character.charCodeAt(0))]
        : [
            ...marker(6, value.length),
            ...Array.from({ length: value.length }, (_, position) =>
              unsigned(value.charCodeAt(position), 2),
            ).flat(),
          ];
    } else if (value instanceof Uint8Array) encoded = [...marker(4, value.length), ...value];
    else {
      const list = children[index]!;
      const count = Array.isArray(value) ? list.length : list.length / 2;
      encoded = [
        ...marker(Array.isArray(value) ? 0xa : 0xd, count),
        ...list.flatMap((child) => unsigned(child, reference)),
      ];
    }
    for (const byte of encoded) bytes.push(byte);
    return at;
  });
  const table = bytes.length;
  const offset = sizeOf(table);
  for (const at of offsets) bytes.push(...unsigned(at, offset));
  bytes.push(0, 0, 0, 0, 0, 0, offset, reference);
  bytes.push(...unsigned(objects.length, 8), ...unsigned(0, 8), ...unsigned(table, 8));
  return Uint8Array.from(bytes);
}

/** Base64 in lines of 76 characters, as mail writes it. */
const base64Lines = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/.{76}/g, '$&\r\n');
const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n');
/** An RFC 2047 encoded word in UTF-8 base64. */
const encodedWord = (text: string) => `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;

/** A message with plain and HTML forms, an image the HTML shows by Content-ID, a remote image it
 * names, and an attachment. Its header uses RFC 2047 encoded words. */
function fieldTripMessage(image: Uint8Array): string {
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, sans-serif; color: #202733">
<h2 style="margin: 0 0 8px">Saturday at the lighthouse</h2>
<p>Hello team,</p>
<p>We meet at <strong>08:30</strong> by the north gate. The route is on the map below.</p>
<p><img src="cid:route-map@viewer.example" alt="Route map" width="160" height="120"></p>
<p><img src="https://images.example.invalid/banner.png" alt="Remote banner, blocked"></p>
<p>Bring the packing list attached to this message.<br>Ana</p>
</body></html>
`;
  const plain = `Hello team,

We meet at 08:30 by the north gate. The route map is in the HTML version.
Bring the packing list attached to this message.

Ana
`;
  return crlf(`From: =?UTF-8?Q?Ana_Ionescu?= <ana@example.invalid>
To: Field team <team@example.invalid>
Cc: ${encodedWord('Ștefan Popa')} <stefan@example.invalid>
Subject: =?UTF-8?Q?Field_trip:_Saturday_at_the_lighthouse_=E2=9B=B5?=
Date: Fri, 06 Mar 2026 18:42:00 +0200
Message-ID: <field-trip@viewer.example>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="mixed-boundary"

This is a multi-part message in MIME format.

--mixed-boundary
Content-Type: multipart/alternative; boundary="alternative-boundary"

--alternative-boundary
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

${plain.replace(/=/g, '=3D')}
--alternative-boundary
Content-Type: multipart/related; boundary="related-boundary"; type="text/html"

--related-boundary
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: base64

${base64Lines(new TextEncoder().encode(html))}
--related-boundary
Content-Type: image/png; name="route-map.png"
Content-Transfer-Encoding: base64
Content-ID: <route-map@viewer.example>
Content-Disposition: inline; filename="route-map.png"

${base64Lines(image)}
--related-boundary--

--alternative-boundary--

--mixed-boundary
Content-Type: text/plain; charset=utf-8; name="Packing list.txt"
Content-Disposition: attachment; filename*=utf-8''Packing%20list.txt
Content-Transfer-Encoding: quoted-printable

Water, 1 l
Rain jacket
Snacks for the caf=C3=A9 stop

--mixed-boundary--
`);
}

/** Apple Mail's form: the message's length, the message, then Mail's flags. */
function emlx(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const flags = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>date-received</key>
	<integer>1772815320</integer>
	<key>flags</key>
	<integer>8590195713</integer>
</dict>
</plist>
`;
  return Uint8Array.from([
    ...new TextEncoder().encode(`${bytes.length}        \n`),
    ...bytes,
    ...new TextEncoder().encode(flags),
  ]);
}

/** Four messages in mboxrd form: a `From ` line before each, a blank line between them, and a
 * body line that starts with `From ` quoted. */
function mailbox(): string {
  const message = (from: string, date: string, subject: string, headers: string, body: string) =>
    `From ${from} ${date}\n${headers}Subject: ${subject}\n\n${body}\n`;
  return [
    message(
      'ana@example.invalid',
      'Mon Mar  2 09:12:00 2026',
      'Lighthouse survey dates',
      'From: Ana Ionescu <ana@example.invalid>\nTo: team@example.invalid\nDate: Mon, 02 Mar 2026 09:12:00 +0200\n',
      'Can everyone make Saturday the 7th?\n>From the last survey, mornings work best.\n',
    ),
    message(
      'stefan@example.invalid',
      'Mon Mar  2 11:40:00 2026',
      '=?UTF-8?Q?Re:_Lighthouse_survey_dates_=E2=9C=94?=',
      `From: ${encodedWord('Ștefan Popa')} <stefan@example.invalid>\nTo: team@example.invalid\nDate: Mon, 02 Mar 2026 11:40:00 +0200\n`,
      'Saturday works for me.\n',
    ),
    message(
      'mara@example.invalid',
      'Wed Mar  4 16:05:00 2026',
      'Gear list',
      'From: Mara Lin <mara@example.invalid>\nTo: team@example.invalid\nDate: Wed, 04 Mar 2026 16:05:00 +0000\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="gear"\n',
      '--gear\nContent-Type: text/plain; charset=utf-8\n\nTripod, two lenses, spare batteries.\n--gear\nContent-Type: text/html; charset=utf-8\n\n<p>Tripod, <em>two</em> lenses, spare batteries.</p>\n--gear--',
    ),
    message(
      'ana@example.invalid',
      'Fri Mar  6 18:42:00 2026',
      'Field trip: final plan',
      'From: Ana Ionescu <ana@example.invalid>\nTo: team@example.invalid\nDate: Fri, 06 Mar 2026 18:42:00 +0200\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n',
      'We meet at 08:30. Coffee at the caf=E9 after.\n',
    ),
  ].join('\n');
}

/** A FictionBook with a cover, two chapters with a nested section, and a footnote. */
function fictionBook(cover: Uint8Array): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>travel</genre>
      <author><first-name>Ana</first-name><last-name>Ionescu</last-name></author>
      <author><first-name>Mara</first-name><last-name>Lin</last-name></author>
      <book-title>Lighthouse Notes</book-title>
      <annotation><p>A short field journal written for the Viewer playground.</p></annotation>
      <date value="2026-03-07">7 March 2026</date>
      <coverpage><image l:href="#cover.png"/></coverpage>
      <lang>en</lang>
      <sequence name="Field journals" number="1"/>
    </title-info>
    <publish-info><publisher>Viewer playground</publisher><year>2026</year></publish-info>
  </description>
  <body>
    <title><p>Lighthouse Notes</p></title>
    <epigraph><p>The light keeps its own hours.</p><text-author>Harbour saying</text-author></epigraph>
    <section id="morning">
      <title><p>Morning</p></title>
      <p>We left the north gate at <strong>08:30</strong>, with the tide still out.</p>
      <p>The path follows the old rail line<a l:href="#note-1" type="note">[1]</a> to the cliff.</p>
      <section>
        <title><p>The keeper's house</p></title>
        <p>Its door is painted <emphasis>sea green</emphasis>, as it was in the photographs.</p>
      </section>
    </section>
    <section id="evening">
      <title><p>Evening</p></title>
      <p>From the gallery the lamp turns every ten seconds.</p>
      <empty-line/>
      <poem><stanza><v>Ten seconds of dark,</v><v>one second of light.</v></stanza></poem>
    </section>
  </body>
  <body name="notes">
    <title><p>Notes</p></title>
    <section id="note-1"><title><p>1</p></title><p>The line closed in 1961.</p></section>
  </body>
  <binary id="cover.png" content-type="image/png">${Buffer.from(cover).toString('base64')}</binary>
</FictionBook>
`;
}

/** A page Safari saved, with its stylesheet and picture; it also names a script and an image the
 * archive does not hold. */
function webArchive(image: Uint8Array): Uint8Array {
  const url = 'https://field-notes.example.invalid/trip/';
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Field notes: the lighthouse trip</title>
<link rel="stylesheet" href="style.css">
<script src="https://cdn.example.invalid/tracker.js"></script>
</head>
<body>
<h1>The lighthouse trip</h1>
<p class="lead">A page saved for the Viewer playground.</p>
<img src="/media/route-map.png" alt="Route map" width="160" height="120">
<img src="https://ads.example.invalid/banner.gif" alt="Not in the archive">
<p><a href="https://field-notes.example.invalid/">Back to the notes</a></p>
</body>
</html>
`;
  const css = `body { font: 16px/1.5 Georgia, serif; margin: 32px; color: #1d2733; background: #f7f3ea; }
h1 { color: #31556b; }
.lead { font-style: italic; background: url(/media/route-map.png) no-repeat right center / 24px; }
`;
  return binaryPlist({
    WebMainResource: {
      WebResourceData: new TextEncoder().encode(html),
      WebResourceFrameName: '',
      WebResourceMIMEType: 'text/html',
      WebResourceTextEncodingName: 'UTF-8',
      WebResourceURL: url,
    },
    WebSubresources: [
      {
        WebResourceData: new TextEncoder().encode(css),
        WebResourceMIMEType: 'text/css',
        WebResourceTextEncodingName: 'UTF-8',
        WebResourceURL: url + 'style.css',
      },
      {
        WebResourceData: image,
        WebResourceMIMEType: 'image/png',
        WebResourceURL: 'https://field-notes.example.invalid/media/route-map.png',
      },
    ],
  });
}

/** Email, a mailbox, a FictionBook and a Safari web archive; `image` is a small PNG. */
export function messageSamples(image: Uint8Array): Sample[] {
  const message = fieldTripMessage(image);
  return [
    sample(
      'previews/messages/Field trip.eml',
      ['eml'],
      'Header, HTML body with its inline map, blocked remote image, attachment list',
      'A multipart message: plain and HTML forms, a Content-ID image and a text attachment.',
      message,
    ),
    sample(
      'previews/messages/Field trip.emlx',
      ['emlx'],
      'The same message as Apple Mail stores it',
      'The message after its byte count, followed by the property list of Mail flags.',
      emlx(message),
    ),
    sample(
      'previews/messages/Field team.mbox',
      ['mbox'],
      'A list of four messages; each opens in the message view',
      'An mboxrd mailbox with plain, HTML and Latin-1 messages and a quoted From line.',
      mailbox(),
    ),
    sample(
      'previews/documents/Lighthouse notes.fb2',
      ['fb2'],
      'Book reader: cover, title, authors, chapters and a footnote',
      'A FictionBook 2 book with an embedded PNG cover.',
      fictionBook(image),
    ),
    sample(
      'previews/documents/Lighthouse trip.webarchive',
      ['webarchive'],
      'The saved page with its stylesheet and picture; remote parts stay blocked',
      'A binary property list holding the page, its stylesheet and one image.',
      webArchive(image),
    ),
  ];
}
