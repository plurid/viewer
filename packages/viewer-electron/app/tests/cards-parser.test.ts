import { describe, expect, it } from 'vitest';
import {
  decodeFoldedText,
  parseCalendar,
  parseContacts,
  parseContentLine,
  parseDuration,
  readCards,
  splitValue,
  unescapeText,
  unfoldContentLines,
} from '../src/domain/previews/data/cards';

const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';

// As Google Calendar exports: CRLF lines folded at 75 octets, UTC and zoned times, an alarm.
const calendar = crlf([
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-CALNAME:Team\\, Berlin',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261103T093000',
  'DTEND;TZID=Europe/Berlin:20261103T100000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'ORGANIZER;CN="Ana Pop, PM":mailto:ana@example.com',
  'SUMMARY:Stand-up',
  'DESCRIPTION:Agenda:\\n1. Blockers\\; risks\\n2. Plans\\, next steps. A long',
  '  line folded by the writer at seventy-five octets.',
  'LOCATION:Room 4\\, Floor 2',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H10M0S',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261102',
  'DTEND;VALUE=DATE:20261104',
  'SUMMARY:Offsite',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261101T080000Z',
  'DURATION:PT1H30M',
  'SUMMARY:Flight',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VTODO',
  'SUMMARY:Book rooms',
  'DUE;VALUE=DATE:20261030',
  'STATUS:NEEDS-ACTION',
  'END:VTODO',
  'BEGIN:VTODO',
  'SUMMARY:Send invites',
  'COMPLETED:20261028T120000Z',
  'END:VTODO',
  'END:VCALENDAR',
]);

describe('content lines', () => {
  it('unfolds CRLF and LF continuations and drops blank lines', () => {
    expect(unfoldContentLines('A:one\r\n two\r\n\tthree\n\nB:four\n').lines).toEqual([
      'A:onetwothree',
      'B:four',
    ]);
  });

  it('splits group, name, quoted and listed parameters, and bare 2.1 types', () => {
    expect(parseContentLine('item1.TEL;TYPE="cell,voice";PREF=1:+1 555 0100')).toEqual({
      group: 'item1',
      name: 'TEL',
      parameters: { TYPE: ['cell,voice'], PREF: ['1'] },
      value: '+1 555 0100',
    });
    expect(parseContentLine('tel;work;Voice:555')).toMatchObject({
      name: 'TEL',
      parameters: { TYPE: ['work', 'Voice'] },
    });
    expect(parseContentLine('ATTENDEE;CN="Doe: Jane";ROLE=REQ-PARTICIPANT:mailto:j@x.org')).toEqual(
      {
        group: undefined,
        name: 'ATTENDEE',
        parameters: { CN: ['Doe: Jane'], ROLE: ['REQ-PARTICIPANT'] },
        value: 'mailto:j@x.org',
      },
    );
    expect(parseContentLine(`ADR;LABEL="Line one^nLine ^'two^'":;;Main St`)).toMatchObject({
      parameters: { LABEL: ['Line one\nLine "two"'] },
    });
    expect(parseContentLine('no colon here')).toBeUndefined();
  });

  it('unescapes text and splits structured values only on unescaped separators', () => {
    expect(unescapeText('a\\, b\\; c\\\\d\\nnext\\Nline')).toBe('a, b; c\\d\nnext\nline');
    expect(splitValue('Doe;Jane\\;Ann;;Dr.', ';')).toEqual(['Doe', 'Jane\\;Ann', '', 'Dr.']);
    expect(splitValue('one\\,two,three', ',')).toEqual(['one\\,two', 'three']);
  });

  it('restores a UTF-8 character a writer folded across lines', () => {
    const bytes = new TextEncoder().encode('SUMMARY:Café ☕\r\n');
    // fold inside both multi-byte characters: after the first byte of é and of the cup
    const folded = new Uint8Array([
      ...bytes.slice(0, 12),
      0x0d,
      0x0a,
      0x20,
      ...bytes.slice(12, 15),
      0x0a,
      0x09,
      ...bytes.slice(15),
    ]);
    expect(new TextDecoder().decode(folded)).toContain('�');
    expect(decodeFoldedText(folded)).toBe('SUMMARY:Café ☕\r\n');
  });
});

describe('calendars', () => {
  it('lists events in start order with their own properties and tasks', () => {
    const parsed = parseCalendar(calendar);
    expect(parsed.name).toBe('Team, Berlin');
    expect(parsed.truncated).toBe(false);
    expect(parsed.events.map((event) => event.summary)).toEqual(['Flight', 'Offsite', 'Stand-up']);
    const [flight, offsite, standup] = parsed.events;
    expect(flight).toMatchObject({ allDay: false, status: 'CANCELLED', repeats: false });
    expect(flight!.start!.instant).toBe(Date.UTC(2026, 10, 1, 8, 0));
    expect(flight!.end).toMatchObject({ hour: 9, minute: 30, utc: true });
    expect(flight!.end!.instant).toBe(Date.UTC(2026, 10, 1, 9, 30));
    expect(offsite).toMatchObject({
      allDay: true,
      start: { year: 2026, month: 11, day: 2, date: true },
      end: { day: 4, date: true },
    });
    expect(standup).toMatchObject({
      allDay: false,
      repeats: true,
      location: 'Room 4, Floor 2',
      organizer: 'Ana Pop, PM <ana@example.com>',
      description:
        'Agenda:\n1. Blockers; risks\n2. Plans, next steps. A long line folded by the writer at ' +
        'seventy-five octets.',
      start: { hour: 9, minute: 30, zone: 'Europe/Berlin', utc: false },
    });
    // Berlin is UTC+1 in November
    expect(standup!.start!.instant).toBe(Date.UTC(2026, 10, 3, 8, 30));
    expect(parsed.todos).toEqual([
      {
        summary: 'Book rooms',
        due: expect.objectContaining({ year: 2026, month: 10, day: 30, date: true }),
        status: 'NEEDS-ACTION',
        completed: false,
      },
      { summary: 'Send invites', due: undefined, status: undefined, completed: true },
    ]);
  });

  it('keeps floating and unknown-zone times on their wall clock', () => {
    const parsed = parseCalendar(
      crlf([
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;TZID=W. Europe Standard Time:20260601T120000',
        'SUMMARY:Outlook zone',
        'X-MICROSOFT-CDO-ALLDAYEVENT:FALSE',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:20260601T080000',
        'SUMMARY:Floating',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:No date',
        'END:VEVENT',
        'END:VCALENDAR',
      ]),
    );
    expect(parsed.events.map((event) => event.summary)).toEqual([
      'Floating',
      'Outlook zone',
      'No date',
    ]);
    expect(parsed.events[1]!.start).toMatchObject({
      hour: 12,
      zone: 'W. Europe Standard Time',
      instant: undefined,
    });
    expect(parsed.events[0]!.start!.instant).toBeUndefined();
  });

  it('reads durations and bounds the entries it lists', () => {
    expect(parseDuration('PT1H30M')).toBe(90 * 60_000);
    expect(parseDuration('P1W2D')).toBe(9 * 24 * 3_600_000);
    expect(parseDuration('-PT15M')).toBe(-15 * 60_000);
    expect(parseDuration('P')).toBeUndefined();
    expect(parseDuration('PT')).toBeUndefined();
    const events = Array.from({ length: 5 }, (_, index) => [
      'BEGIN:VEVENT',
      `SUMMARY:Event ${index}`,
      'END:VEVENT',
    ]).flat();
    const limited = parseCalendar(crlf(['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR']), {
      lines: 1000,
      entries: 3,
      value: 100,
      photo: 100,
    });
    expect(limited.events).toHaveLength(3);
    expect(limited.truncated).toBe(true);
  });
});

// A one-pixel PNG.
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const contacts = [
  // vCard 3.0 as macOS Contacts exports it, with grouped labels and a folded photo
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'N:Pop;Ana;Maria;Dr.;PhD',
  'FN:Dr. Ana Maria Pop',
  'ORG:Plurid\\, Inc.;Research',
  'TITLE:Principal Engineer',
  'EMAIL;type=INTERNET;type=WORK;type=pref:ana@example.com',
  'item1.EMAIL;type=INTERNET:ana.pop@example.org',
  'item1.X-ABLabel:_$!<Other>!$_',
  'TEL;type=CELL;type=VOICE;type=pref:+40 721 000 111',
  'item2.TEL:+40 21 000 2222',
  'item2.X-ABLabel:Studio',
  'item3.ADR;type=HOME;type=pref:;;Strada Lunga 5\\nApt 3;Cluj-Napoca;CJ;400000;Romania',
  'BDAY:1987-04-12',
  'NOTE:Prefers email\\, not calls.',
  `PHOTO;ENCODING=b;TYPE=PNG:${pixel.slice(0, 50)}`,
  ` ${pixel.slice(50)}`,
  'END:VCARD',
  // vCard 4.0 with a data URI photo and a month-and-day birthday
  'BEGIN:VCARD',
  'VERSION:4.0',
  'FN:Ion Rusu',
  'TEL;VALUE=uri;TYPE="work,voice":tel:+40-264-000-333',
  'BDAY:--0229',
  `PHOTO:data:image/png;base64,${pixel}`,
  'END:VCARD',
  // vCard 2.1 with quoted-printable UTF-8 and a soft line break
  'BEGIN:VCARD',
  'VERSION:2.1',
  'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C8=98tef=C4=83nescu;Mihai',
  'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:First line=0D=0A=C3=AEn al doilea r=',
  '=C3=A2nd',
  'TEL;WORK;VOICE:021 555 0199',
  'END:VCARD',
].join('\n');

describe('contacts', () => {
  it('reads one card per contact across vCard 2.1, 3.0 and 4.0', () => {
    const parsed = parseContacts(contacts);
    expect(parsed.truncated).toBe(false);
    expect(parsed.contacts).toHaveLength(3);
    const [ana, ion, mihai] = parsed.contacts;
    expect(ana).toEqual({
      name: 'Dr. Ana Maria Pop',
      organization: 'Plurid, Inc., Research',
      title: 'Principal Engineer',
      emails: [
        { value: 'ana@example.com', types: ['work'], label: undefined },
        { value: 'ana.pop@example.org', types: [], label: 'Other' },
      ],
      phones: [
        { value: '+40 721 000 111', types: ['cell'], label: undefined },
        { value: '+40 21 000 2222', types: [], label: 'Studio' },
      ],
      addresses: [
        {
          value: 'Strada Lunga 5\nApt 3\nCluj-Napoca, CJ 400000\nRomania',
          types: ['home'],
          label: undefined,
        },
      ],
      birthday: { year: 1987, month: 4, day: 12 },
      note: 'Prefers email, not calls.',
      photo: `data:image/png;base64,${pixel}`,
    });
    expect(ion).toMatchObject({
      name: 'Ion Rusu',
      phones: [{ value: '+40-264-000-333', types: ['work'] }],
      birthday: { month: 2, day: 29 },
      photo: `data:image/png;base64,${pixel}`,
    });
    expect(mihai).toMatchObject({
      name: 'Mihai Ștefănescu',
      note: 'First line\r\nîn al doilea rând',
      phones: [{ value: '021 555 0199', types: ['work'] }],
    });
  });

  it('ignores photos it cannot show safely', () => {
    const parsed = parseContacts(
      [
        'BEGIN:VCARD',
        'FN:Linked',
        'PHOTO;VALUE=uri:https://example.com/photo.jpg',
        'END:VCARD',
        'BEGIN:VCARD',
        'FN:Script',
        'PHOTO:data:text/html;base64,PHNjcmlwdD4=',
        'END:VCARD',
      ].join('\n'),
    );
    expect(parsed.contacts.map((contact) => contact.photo)).toEqual([undefined, undefined]);
  });
});

describe('card documents', () => {
  it('tells calendars, contacts and genomic variant calls apart by content', () => {
    expect(readCards(calendar).kind).toBe('calendar');
    expect(readCards(contacts).kind).toBe('contacts');
    expect(
      readCards(
        [
          '##fileformat=VCFv4.2',
          '##source=GATK',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
          '20\t14370\trs6054257\tG\tA\t29\tPASS\tNS=3;DP=14;AF=0.5',
        ].join('\n'),
      ),
    ).toEqual({ kind: 'variant-calls' });
    expect(readCards('﻿##fileformat=VCFv4.3\n').kind).toBe('variant-calls');
    expect(readCards('just some notes').kind).toBe('unknown');
  });
});
