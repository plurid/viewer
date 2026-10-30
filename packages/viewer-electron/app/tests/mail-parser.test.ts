import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  decodeQuotedPrintable,
  decodeText,
  decodeWords,
  fieldParameters,
  mimeLimits,
  parseMime,
} from '../src/domain/previews/mail/mime';
import {
  addressList,
  emlxMessage,
  mailLimits,
  messagePage,
  readMessage,
} from '../src/domain/previews/mail/message';
import {
  MailboxScanner,
  mailboxMessage,
  mailboxRow,
  mailboxMessageRequestSchema,
} from '../src/domain/previews/mail/mailbox';
import { documentRequestSchema } from '../src/domain/previews/documents/requests';
import { rewritePage, savedPageLimits } from '../src/domain/previews/saved-page';

const bytes = (text: string) => new TextEncoder().encode(text);
const crlf = (text: string) => bytes(text.replace(/\r?\n/g, '\r\n'));
const base64 = (data: Uint8Array | string) => Buffer.from(data).toString('base64');
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
);

describe('header fields', () => {
  it('decodes encoded words in Q and B forms, joining adjacent words without their space', () => {
    expect(decodeWords('=?UTF-8?Q?Caf=C3=A9_meeting?=')).toBe('Café meeting');
    expect(decodeWords(`=?utf-8?B?${base64('Ștefan')}?= Popa`)).toBe('Ștefan Popa');
    expect(decodeWords('=?ISO-8859-1?Q?Andr=E9?= =?ISO-8859-1?Q?_Pirard?=')).toBe('André Pirard');
    // a character split between two words decodes once they are joined
    const snowman = Buffer.from('☃');
    expect(
      decodeWords(
        `=?UTF-8?B?${base64(snowman.subarray(0, 1))}?= =?UTF-8?B?${base64(snowman.subarray(1))}?=`,
      ),
    ).toBe('☃');
    expect(decodeWords('=?KOI8-R?B?8NLJ18XU?= world')).toBe('Привет world');
    expect(decodeWords('=?utf-8*en?Q?Hello?=')).toBe('Hello');
    expect(decodeWords('plain =?broken')).toBe('plain =?broken');
  });

  it('reads parameters, quoted, RFC 2231 continued and charset-encoded', () => {
    expect(fieldParameters('Text/Plain; charset="UTF-8"; format=flowed')).toEqual({
      value: 'text/plain',
      parameters: { charset: 'UTF-8', format: 'flowed' },
    });
    expect(
      fieldParameters(
        "attachment; filename*0*=utf-8''R%C3%A9sum%C3%A9%20; filename*1*=%E2%80%93%20draft; filename*2=.pdf",
      ).parameters.filename,
    ).toBe('Résumé – draft.pdf');
    expect(fieldParameters('inline; filename="=?UTF-8?Q?pl=C3=A2n.png?="').parameters).toEqual({
      filename: 'plân.png',
    });
    expect(fieldParameters('multipart/mixed; boundary="a;b\\"c"').parameters.boundary).toBe(
      'a;b"c',
    );
  });

  it('shows address lists with display names unquoted', () => {
    expect(addressList('"Doe, Jane" <jane@example.invalid>, bob@example.invalid')).toBe(
      'Doe, Jane <jane@example.invalid>, bob@example.invalid',
    );
  });
});

describe('transfer encodings and charsets', () => {
  it('decodes quoted-printable soft breaks and escapes, keeping a stray equals sign', () => {
    const text = new TextDecoder().decode(
      decodeQuotedPrintable(bytes('Caf=C3=A9 au l=\r\nait =3D 2 =ZZ end=\n')),
    );
    expect(text).toBe('Café au lait = 2 =ZZ end');
  });

  it('decodes base64 across line breaks and stray characters, and stops at padding', () => {
    expect(
      new TextDecoder().decode(decodeBase64(bytes('SGVs\r\nbG8g\r\n*d29y bGQ=\r\nIGdhcmJhZ2U='))),
    ).toBe('Hello world');
    expect(decodeBase64('')).toEqual(new Uint8Array());
  });

  it('reads the declared charset, and UTF-8 or Windows-1252 without one', () => {
    expect(decodeText(Uint8Array.from([0xcf, 0xf0, 0xe8]), 'windows-1251')).toBe('При');
    expect(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeText(bytes('café'))).toBe('café');
    expect(decodeText(bytes('plain'), 'x-unknown-charset')).toBe('plain');
    expect(decodeText(Uint8Array.from([0x93, 0x51, 0x94]), 'us-ascii')).toBe('“Q”');
  });
});

function message(parts: { headers: string; body: string }[], boundary = 'part', type = 'mixed') {
  return crlf(`From: Ana <ana@example.invalid>
To: team@example.invalid
Subject: =?UTF-8?Q?Plan_=E2=9C=94?=
Date: Fri, 06 Mar 2026 18:42:00 +0200 (EET)
MIME-Version: 1.0
Content-Type: multipart/${type}; boundary="${boundary}"

preamble
${parts.map((part) => `--${boundary}\n${part.headers}\n\n${part.body}\n`).join('')}--${boundary}--
epilogue
`);
}

describe('messages', () => {
  it('reads the header, plain body and attachments of a mixed message', () => {
    const mail = readMessage(
      message([
        {
          headers:
            'Content-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable',
          body: 'Caf=E9 at eight.',
        },
        {
          headers: `Content-Type: application/pdf; name="map.pdf"\nContent-Disposition: attachment\nContent-Transfer-Encoding: base64`,
          body: base64(new Uint8Array(3000)).replace(/.{76}/g, '$&\n'),
        },
        { headers: 'Content-Type: message/rfc822', body: 'Subject: Forwarded note\n\nHello.' },
        { headers: 'Content-Type: application/octet-stream', body: 'raw' },
      ]),
    );
    expect(mail).toMatchObject({
      subject: 'Plan ✔',
      from: 'Ana <ana@example.invalid>',
      to: 'team@example.invalid',
      cc: '',
      time: Date.parse('2026-03-06T16:42:00Z'),
      text: 'Café at eight.',
      html: false,
      limited: false,
    });
    expect(mail.attachments).toEqual([
      { name: 'map.pdf', type: 'application/pdf', size: 3000 },
      { name: 'Forwarded note.eml', type: 'message/rfc822', size: 33 },
      { name: 'Attachment 3.bin', type: 'application/octet-stream', size: 3 },
    ]);
  });

  it('keeps the first plain and the last HTML form of an alternative', () => {
    const mail = readMessage(
      message(
        [
          { headers: 'Content-Type: text/plain', body: 'Plain form' },
          { headers: 'Content-Type: text/html', body: '<p>Simple</p>' },
          { headers: 'Content-Type: text/html', body: '<p>Rich</p>' },
        ],
        'alt',
        'alternative',
      ),
    );
    expect(mail.text).toBe('Plain form');
    expect(mail.html).toBe(true);
    const page = messagePage(
      message(
        [
          { headers: 'Content-Type: text/plain', body: 'Plain form' },
          { headers: 'Content-Type: text/html', body: '<p>Simple</p>' },
          { headers: 'Content-Type: text/html', body: '<p>Rich</p>' },
        ],
        'alt',
        'alternative',
      ),
    );
    expect(page.html).toContain('Rich');
    expect(page.html).not.toContain('Simple');
  });

  it('joins format=flowed lines where their writer wrapped them', () => {
    const mail = readMessage(
      message([
        {
          headers: 'Content-Type: text/plain; format=flowed; delsp=yes',
          body: 'A long line wrap \nped here.\n> quoted\n-- \nsignature',
        },
      ]),
    );
    expect(mail.text).toBe('A long line wrapped here.\n> quoted\n-- \nsignature');
  });

  it('serves the HTML body with its Content-ID images from the message itself', () => {
    const page = messagePage(
      message(
        [
          {
            headers: 'Content-Type: text/html; charset=utf-8',
            body: '<p>Map: <img src="cid:map%40viewer" alt="map"><img src="cid:missing@viewer"><img src="cid:doc@viewer"></p>',
          },
          {
            headers:
              'Content-Type: image/png\nContent-ID: <map@viewer>\nContent-Transfer-Encoding: base64',
            body: base64(png),
          },
          {
            headers: 'Content-Type: application/pdf\nContent-ID: <doc@viewer>',
            body: '%PDF-1.4',
          },
        ],
        'rel',
        'related',
      ),
    );
    expect(page.parts).toEqual([{ path: 'parts/1.png', type: 'image/png', data: png }]);
    expect(page.html).toContain('<img src="parts/1.png" alt="map">');
    expect(page.blocked).toBe(2);
    // a related part the body shows is not listed as an attachment
    const mail = readMessage(
      message(
        [
          { headers: 'Content-Type: text/html', body: '<img src="cid:map@viewer">' },
          { headers: 'Content-Type: image/png\nContent-ID: <map@viewer>', body: 'x' },
        ],
        'rel',
        'related',
      ),
    );
    expect(mail.attachments).toEqual([]);
  });

  it('reads Apple Mail’s emlx: the length line, the message, and not the flags after it', () => {
    const inner = 'Subject: Stored\r\n\r\nBody text';
    const file = bytes(`${bytes(inner).length}   \n${inner}<?xml version="1.0"?><plist/>`);
    expect(new TextDecoder().decode(emlxMessage(file))).toBe(inner);
    expect(readMessage(emlxMessage(file))).toMatchObject({ subject: 'Stored', text: 'Body text' });
    expect(() => emlxMessage(bytes('Subject: no length\n'))).toThrow('length');
  });

  it('reads malformed messages as far as they go', () => {
    // no closing delimiter, a boundary that only starts a longer one, and a headerless part
    const mail = readMessage(
      crlf(`Subject: Loose
Content-Type: multipart/mixed; boundary=b

--b
Content-Type: text/plain

first
--bb not a delimiter
--b
Content-Type: text/plain

second`),
    );
    expect(mail.text).toBe('first\n--bb not a delimiter\n\nsecond');
    expect(readMessage(bytes('Subject: Only headers'))).toMatchObject({
      subject: 'Only headers',
      text: '',
      html: false,
    });
    expect(readMessage(bytes('\nBody without headers')).text).toBe('Body without headers');
    expect(readMessage(bytes('Content-Type: nonsense\n\nstill text')).text).toBe('still text');
    expect(() => parseMime(new Uint8Array(mimeLimits.headerBytes + 10).fill(65))).toThrow(
      'headers exceed',
    );
  });

  it('bounds parts, nesting, attachments and text', () => {
    const many = readMessage(
      message(
        Array.from({ length: mimeLimits.parts + 5 }, () => ({
          headers: 'Content-Type: application/octet-stream',
          body: 'x',
        })),
      ),
    );
    expect(many.limited).toBe(true);
    expect(many.attachments).toHaveLength(mailLimits.attachments);
    let nested = 'Content-Type: text/plain\n\ninnermost';
    for (let depth = 0; depth < mimeLimits.depth + 4; depth++)
      nested = `Content-Type: multipart/mixed; boundary="d${depth}"\n\n--d${depth}\n${nested}\n--d${depth}--`;
    expect(readMessage(bytes(nested)).limited).toBe(true);
    const long = readMessage(
      message([
        { headers: 'Content-Type: text/plain', body: 'a'.repeat(mailLimits.textCharacters + 9) },
      ]),
    );
    expect(long.text).toHaveLength(mailLimits.textCharacters);
    expect(long.limited).toBe(true);
  });

  it('does not serve an image past the part limit', () => {
    const big = new Uint8Array(savedPageLimits.partBytes + 1);
    big.set(png);
    const page = messagePage(
      message(
        [
          { headers: 'Content-Type: text/html', body: '<img src="cid:big@viewer">' },
          {
            headers:
              'Content-Type: image/png\nContent-ID: <big@viewer>\nContent-Transfer-Encoding: base64',
            body: base64(big),
          },
        ],
        'rel',
        'related',
      ),
    );
    expect(page.parts).toEqual([]);
    expect(page.blocked).toBe(1);
  });
});

describe('remote content in an HTML message', () => {
  const html = `<!doctype html><html><head>
<meta http-equiv="refresh" content="0; url=https://track.example.invalid/open">
<base href="https://track.example.invalid/">
<link rel="stylesheet" href="https://track.example.invalid/style.css">
<link rel="dns-prefetch" href="//track.example.invalid">
<style>@import url("https://track.example.invalid/a.css"); body { background: url(https://track.example.invalid/bg.png) }</style>
<script src="https://track.example.invalid/x.js"></script><script>fetch('https://track.example.invalid/beacon')</script>
</head><body background="https://track.example.invalid/body.png" onload="alert(1)">
<img src="https://track.example.invalid/pixel.gif" width="1" height="1">
<img srcset="https://track.example.invalid/a.png 1x, //track.example.invalid/b.png 2x">
<IMG SRC=http://track.example.invalid/upper.gif>
<div style="background-image: url('https://track.example.invalid/div.png')">Hi</div>
<iframe src="https://track.example.invalid/frame"></iframe>
<object data="https://track.example.invalid/movie.swf"></object>
<video poster="https://track.example.invalid/poster.jpg"></video>
<!-- <img src="https://track.example.invalid/in-comment.gif"> --!> <img src="https://track.example.invalid/after-comment.gif">
<form action="https://track.example.invalid/submit"><input type="image" src="https://track.example.invalid/button.png"></form>
<a href="https://shop.example.invalid/offer" ping="https://track.example.invalid/ping">Offer</a>
<a href="#top">Top</a>
<img src="data:image/png;base64,${base64(png)}">
</body></html>`;

  it('leaves no remote resource in the page and counts what it removed', () => {
    const page = rewritePage(html, () => undefined);
    // the only remote addresses left are a link's, kept as its title, and a comment's: neither
    // loads anything
    const resources = [
      ...page.html
        .replace(/<!--[\s\S]*?--!?>/g, '')
        .matchAll(/\s(?:src|srcset|href|background|poster|data|action|ping)="([^"]*)"/gi),
    ].map((match) => match[1]);
    expect(resources.filter((value) => /example\.invalid/.test(value ?? ''))).toEqual([]);
    expect(page.html).not.toMatch(/<script|<iframe|<object|<base|http-equiv|onload|dns-prefetch/i);
    expect(page.html).toContain(
      '<a data-href="https://shop.example.invalid/offer" title="https://shop.example.invalid/offer">Offer</a>',
    );
    expect(page.html).toContain('<a href="#top">Top</a>');
    expect(page.html).toContain('src="data:image/png;base64,');
    expect(page.html).toContain('in-comment.gif');
    expect(page.html).not.toContain('after-comment.gif');
    expect(page.blocked).toBe(12);
  });

  it('serves no page part for a remote reference whatever the message holds', () => {
    const page = messagePage(
      message([{ headers: 'Content-Type: text/html', body: html }], 'only', 'mixed'),
    );
    expect(page.parts).toEqual([]);
    expect(page.blocked).toBeGreaterThan(0);
    expect(page.html.replace(/<!--[\s\S]*?--!?>/g, '')).not.toMatch(/src="https?:|src="\/\//);
  });
});

describe('mailboxes', () => {
  const mbox = `From ana@example.invalid Mon Mar  2 09:12:00 2026
From: Ana <ana@example.invalid>
Subject: First
Date: Mon, 02 Mar 2026 09:12:00 +0200

Body line
>From quoted, not a message
From inside a paragraph, also not a message

From stefan@example.invalid Mon Mar  2 11:40:00 2026
From: =?UTF-8?Q?=C8=98tefan?= <stefan@example.invalid>
Subject: =?UTF-8?Q?Second_=E2=9C=94?=

Reply
From mara@example.invalid Wed Mar  4 16:05:00 2026
Subject: Third, with no blank line before it

Last
`;

  const scan = (
    data: Uint8Array,
    size: number,
    limits?: { messages: number; headerBytes: number },
  ) => {
    const rows: ReturnType<typeof mailboxRow>[] = [];
    const scanner = new MailboxScanner(
      (span, header) => rows.push(mailboxRow(span, header)),
      limits,
    );
    for (let at = 0; at < data.length; at += size) scanner.write(data.subarray(at, at + size));
    scanner.end();
    return { rows, scanner };
  };

  it('finds the same messages whatever the chunk size', () => {
    const data = bytes(mbox);
    const whole = scan(data, data.length);
    expect(whole.rows.map((row) => [row.from, row.subject])).toEqual([
      ['Ana <ana@example.invalid>', 'First'],
      ['Ștefan <stefan@example.invalid>', 'Second ✔'],
      ['', 'Third, with no blank line before it'],
    ]);
    expect(whole.rows[0]!.time).toBe(Date.parse('2026-03-02T07:12:00Z'));
    for (const size of [1, 3, 7, 64])
      expect(scan(data, size).scanner.spans).toEqual(whole.scanner.spans);
    const spans = whole.scanner.spans;
    expect(spans[0]!.start).toBe(0);
    expect(spans.at(-1)!.end).toBe(data.length);
  });

  it('opens one message with its From line removed and quoted From lines restored', () => {
    const data = bytes(mbox);
    const span = scan(data, 5).scanner.spans[0]!;
    const mail = readMessage(mailboxMessage(data.subarray(span.start, span.end)));
    expect(mail.subject).toBe('First');
    expect(mail.text).toBe(
      'Body line\nFrom quoted, not a message\nFrom inside a paragraph, also not a message',
    );
  });

  it('stops at its message limit and keeps only each header’s start', () => {
    const data = bytes(
      Array.from(
        { length: 6 },
        (_, index) => `From a@b Mon Mar  2 09:12:00 2026\nSubject: ${index}\n\nx\n`,
      ).join('\n'),
    );
    const limited = scan(data, 9, { messages: 4, headerBytes: 8 });
    expect(limited.scanner.stopped).toBe(true);
    expect(limited.scanner.spans).toHaveLength(4);
    // eight bytes of header hold no complete Subject field
    expect(limited.rows[0]!.subject).toBe('');
    expect(scan(bytes('not a mailbox\n'), 4).rows).toEqual([]);
  });

  it('accepts a message request by position only', () => {
    expect(mailboxMessageRequestSchema.safeParse({ requestID: 'r', message: 2 }).success).toBe(
      true,
    );
    for (const request of [
      { requestID: 'r', message: -1 },
      { requestID: 'r', message: 10_000 },
      { requestID: 'r', message: 1, path: '/other.mbox' },
      { message: 1 },
    ])
      expect(documentRequestSchema.safeParse(request).success).toBe(false);
    expect(documentRequestSchema.parse({ requestID: 'r', message: 2 })).toEqual({
      requestID: 'r',
      message: 2,
    });
    expect(documentRequestSchema.parse({ requestID: 'r', sheet: 'Data' })).toMatchObject({
      sheet: 'Data',
      fromRow: 1,
    });
  });
});
