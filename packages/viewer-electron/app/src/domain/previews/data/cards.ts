/**
 * iCalendar (RFC 5545) and vCard (RFC 6350, and the 2.1 and 3.0 forms still exported) read for
 * preview. Content lines are unfolded, then split into group, name, parameters and value; each
 * property unescapes its own value, so structured values split before their escapes are removed.
 */

export interface ContentLine {
  /** A vCard property group, such as `item1` in `item1.EMAIL`. */
  group?: string;
  /** Upper case, such as `DTSTART` or `TEL`. */
  name: string;
  /** Upper-case names; values unquoted. A bare 2.1 parameter (`TEL;WORK`) is a TYPE. */
  parameters: Record<string, string[]>;
  /** As written: structured values split on their separators before unescaping. */
  value: string;
}

export interface CalendarTime {
  year: number;
  /** From 1. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** A date without a time of day. */
  date: boolean;
  /** Written in UTC, with a `Z`. */
  utc: boolean;
  /** The TZID the wall-clock time belongs to. */
  zone?: string;
  /** Milliseconds since the epoch, when UTC or a zone the platform knows fixes the instant. */
  instant?: number;
}

export interface CalendarEvent {
  summary: string;
  start?: CalendarTime;
  end?: CalendarTime;
  allDay: boolean;
  location?: string;
  description?: string;
  organizer?: string;
  status?: string;
  /** A recurrence rule or dates: only the first occurrence is listed. */
  repeats: boolean;
}

export interface CalendarTodo {
  summary: string;
  due?: CalendarTime;
  status?: string;
  completed: boolean;
}

export interface Calendar {
  kind: 'calendar';
  name?: string;
  /** In start order; events without a start come last. */
  events: CalendarEvent[];
  todos: CalendarTodo[];
  /** Entries or lines beyond the preview limit were not read. */
  truncated: boolean;
}

export interface ContactValue {
  value: string;
  /** Lower case, without `pref`, `internet` and `voice`. */
  types: string[];
  /** A custom label, from Apple's grouped `X-ABLabel`. */
  label?: string;
}

export type ContactDate = { year?: number; month: number; day: number } | { text: string };

export interface Contact {
  name?: string;
  organization?: string;
  title?: string;
  emails: ContactValue[];
  phones: ContactValue[];
  /** Each address as lines joined by `\n`. */
  addresses: ContactValue[];
  birthday?: ContactDate;
  note?: string;
  /** An embedded photo as a `data:` URI. Linked photos are not fetched. */
  photo?: string;
}

export interface ContactBook {
  kind: 'contacts';
  contacts: Contact[];
  truncated: boolean;
}

/** A `.vcf` that is a genomic Variant Call Format file rather than a vCard. */
export interface VariantCalls {
  kind: 'variant-calls';
}

export interface UnknownCards {
  kind: 'unknown';
}

export type CardDocument = Calendar | ContactBook | VariantCalls | UnknownCards;

export interface CardLimits {
  lines: number;
  entries: number;
  /** Characters of one displayed value. */
  value: number;
  /** Base64 characters of one photo. */
  photo: number;
}

export const cardLimits: CardLimits = {
  lines: 500_000,
  entries: 5000,
  value: 20_000,
  photo: 1_500_000,
};

const bareEncodings = new Set(['QUOTED-PRINTABLE', 'BASE64', 'B', '8BIT', '7BIT']);
const noiseTypes = new Set(['pref', 'internet', 'voice', 'x400']);
const photoTypes: Record<string, string> = {
  JPEG: 'image/jpeg',
  JPG: 'image/jpeg',
  PNG: 'image/png',
  GIF: 'image/gif',
  WEBP: 'image/webp',
};
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isVariantCallFormat(text: string): boolean {
  return /^﻿?##fileformat=VCF/.test(text);
}

const quotedPrintable = (line: string) => /^[^:]*QUOTED-PRINTABLE/i.test(line);

/**
 * Logical lines: a line starting with a space or tab continues the one before (RFC 5545 3.1), and
 * a 2.1 quoted-printable value ending in `=` continues on the next line. Blank lines are dropped.
 */
export function unfoldContentLines(
  text: string,
  limit = cardLimits.lines,
): { lines: string[]; truncated: boolean } {
  const physical = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const lines: string[] = [];
  let softBreak = false;
  for (const line of physical) {
    const last = lines.length - 1;
    if (softBreak && last >= 0) lines[last] = lines[last]!.slice(0, -1) + line;
    else if ((line.startsWith(' ') || line.startsWith('\t')) && last >= 0)
      lines[last] += line.slice(1);
    else if (line.trim() === '') continue;
    else if (lines.length >= limit) return { lines, truncated: true };
    else lines.push(line);
    const current = lines[lines.length - 1]!;
    softBreak = current.endsWith('=') && quotedPrintable(current);
  }
  return { lines, truncated: false };
}

/**
 * Text decoded after unfolding its bytes. A simple writer may fold inside a multi-byte UTF-8
 * character, which only decodes once the fold is removed from the bytes.
 */
export function decodeFoldedText(bytes: Uint8Array): string {
  const joined = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    const crlf = byte === 0x0d && bytes[index + 1] === 0x0a;
    const breakLength = crlf ? 2 : byte === 0x0a ? 1 : 0;
    const next = bytes[index + breakLength];
    if (breakLength && (next === 0x20 || next === 0x09)) {
      index += breakLength;
      continue;
    }
    joined[length++] = byte;
  }
  return new TextDecoder('utf-8').decode(joined.subarray(0, length));
}

/** RFC 6868: `^n` is a line break, `^'` a double quote and `^^` a caret. */
function parameterText(value: string): string {
  return value.replace(/\^([n'^])/g, (_, char: string) =>
    char === 'n' ? '\n' : char === "'" ? '"' : '^',
  );
}

export function parseContentLine(line: string): ContentLine | undefined {
  const head = /^(?:([A-Za-z0-9-]+)\.)?([A-Za-z0-9-]+)/.exec(line);
  if (!head) return undefined;
  const parameters: Record<string, string[]> = {};
  const token = /[A-Za-z0-9-]+/y;
  let cursor = head[0].length;
  while (line[cursor] === ';') {
    token.lastIndex = cursor + 1;
    const key = token.exec(line)?.[0];
    if (!key) return undefined;
    cursor = token.lastIndex;
    if (line[cursor] !== '=') {
      const name = bareEncodings.has(key.toUpperCase()) ? 'ENCODING' : 'TYPE';
      (parameters[name] ??= []).push(key);
      continue;
    }
    const values: string[] = [];
    do {
      cursor++;
      if (line[cursor] === '"') {
        const close = line.indexOf('"', cursor + 1);
        if (close < 0) return undefined;
        values.push(parameterText(line.slice(cursor + 1, close)));
        cursor = close + 1;
      } else {
        let end = cursor;
        while (end < line.length && !';:,'.includes(line[end]!)) end++;
        values.push(parameterText(line.slice(cursor, end)));
        cursor = end;
      }
    } while (line[cursor] === ',');
    (parameters[key.toUpperCase()] ??= []).push(...values);
  }
  if (line[cursor] !== ':') return undefined;
  return {
    group: head[1],
    name: head[2]!.toUpperCase(),
    parameters,
    value: line.slice(cursor + 1),
  };
}

/** A structured (`;`) or list (`,`) value split where no backslash escapes the separator. */
export function splitValue(value: string, separator: ';' | ','): string[] {
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char === '\\' && index + 1 < value.length) {
      current += char + value[index + 1];
      index++;
    } else if (char === separator) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

/** A TEXT value: `\n` (or `\N`) is a line break; `\\`, `\;`, `\,` and `\:` are the character. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,:nN])/g, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  );
}

function textDecoder(charset: string | undefined): TextDecoder {
  try {
    return new TextDecoder(charset || 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

/** Runs of `=XX` bytes decode in the declared charset; the characters between are literal. */
function decodeQuotedPrintable(value: string, charset?: string): string {
  const decoder = textDecoder(charset);
  return value.replace(/(?:=[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
    return decoder.decode(bytes);
  });
}

/** The value with any 2.1 transfer encoding removed, still escaped. */
function rawValue(line: ContentLine): string {
  const encoding = line.parameters.ENCODING?.[0]?.toUpperCase();
  return encoding === 'QUOTED-PRINTABLE'
    ? decodeQuotedPrintable(line.value, line.parameters.CHARSET?.[0])
    : line.value;
}

function textValue(line: ContentLine | undefined, limits: CardLimits): string | undefined {
  if (!line) return undefined;
  const value = unescapeText(rawValue(line)).trim();
  return value ? value.slice(0, limits.value) : undefined;
}

// Calendars

const timePattern = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2})(?::?(\d{2}))?(Z)?)?$/;
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(zone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    if (zoneFormats.size > 64) zoneFormats.clear();
    zoneFormats.set(zone, format);
  }
  return format;
}

/** How far a zone's wall clock is ahead of UTC at an instant. */
function zoneOffset(instant: number, zone: string): number {
  const parts = zoneFormat(zone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - instant;
}

/** The instant a wall-clock time names in an IANA zone; undefined for a zone the platform lacks. */
function zonedInstant(wall: number, zone: string): number | undefined {
  // Outlook and Mozilla prefix IANA names: `/mozilla.org/20050126_1/Europe/Berlin`
  const name = zone.startsWith('/') ? zone.split('/').slice(-2).join('/') : zone;
  try {
    const guess = wall - zoneOffset(wall, name);
    // a second pass settles a guess that crossed a daylight-saving change
    const instant = wall - zoneOffset(guess, name);
    return Number.isFinite(instant) ? instant : undefined;
  } catch {
    return undefined;
  }
}

const wallClock = (time: CalendarTime) =>
  Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);

export function parseCalendarTime(line: ContentLine | undefined): CalendarTime | undefined {
  const match = line && timePattern.exec(line.value.trim());
  if (!line || !match) return undefined;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => Number(part ?? 0)) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60)
    return undefined;
  const date = !match[4] || line.parameters.VALUE?.[0]?.toUpperCase() === 'DATE';
  const utc = !date && !!match[7];
  const zone = date || utc ? undefined : line.parameters.TZID?.[0];
  const time: CalendarTime = { year, month, day, hour, minute, second, date, utc, zone };
  if (date) return { ...time, hour: 0, minute: 0, second: 0 };
  const wall = wallClock(time);
  return { ...time, instant: utc ? wall : zone ? zonedInstant(wall, zone) : undefined };
}

/** Milliseconds of an RFC 5545 DURATION such as `PT1H30M` or `P1D`. */
export function parseDuration(value: string): number | undefined {
  const written = value.trim();
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    written,
  );
  // `P` and `PT` name no amount
  if (!match || written.endsWith('T') || /^[+-]?P$/.test(written)) return undefined;
  const [weeks, days, hours, minutes, seconds] = match
    .slice(2, 7)
    .map((part) => Number(part ?? 0)) as [number, number, number, number, number];
  const total = (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
  return match[1] === '-' ? -total : total;
}

function shifted(time: CalendarTime, milliseconds: number): CalendarTime {
  const moved = new Date(wallClock(time) + milliseconds);
  return {
    ...time,
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    hour: moved.getUTCHours(),
    minute: moved.getUTCMinutes(),
    second: moved.getUTCSeconds(),
    instant: time.instant === undefined ? undefined : time.instant + milliseconds,
  };
}

/** A sort key: the instant, or the wall-clock time read as UTC for floating times and dates. */
export const calendarSortKey = (time: CalendarTime) => time.instant ?? wallClock(time);

function organizer(line: ContentLine | undefined): string | undefined {
  if (!line) return undefined;
  const name = line.parameters.CN?.[0]?.trim();
  const address = unescapeText(line.value)
    .replace(/^mailto:/i, '')
    .trim();
  if (name && address && name !== address) return `${name} <${address}>`;
  return name || address || undefined;
}

/** A component's own properties by name, each with every line of that name in order. */
type Properties = Map<string, ContentLine[]>;

const first = (properties: Properties, name: string) => properties.get(name)?.[0];

function calendarEvent(properties: Properties, limits: CardLimits): CalendarEvent {
  const start = parseCalendarTime(first(properties, 'DTSTART'));
  const duration = parseDuration(first(properties, 'DURATION')?.value ?? '');
  const end =
    parseCalendarTime(first(properties, 'DTEND')) ??
    (start && duration !== undefined ? shifted(start, duration) : undefined);
  const microsoftAllDay =
    first(properties, 'X-MICROSOFT-CDO-ALLDAYEVENT')?.value.trim().toUpperCase() === 'TRUE';
  return {
    summary: textValue(first(properties, 'SUMMARY'), limits) ?? '',
    start,
    end,
    allDay: !!start?.date || microsoftAllDay,
    location: textValue(first(properties, 'LOCATION'), limits),
    description: textValue(first(properties, 'DESCRIPTION'), limits),
    organizer: organizer(first(properties, 'ORGANIZER')),
    status: textValue(first(properties, 'STATUS'), limits),
    repeats: properties.has('RRULE') || properties.has('RDATE'),
  };
}

function calendarTodo(properties: Properties, limits: CardLimits): CalendarTodo {
  const status = textValue(first(properties, 'STATUS'), limits);
  return {
    summary: textValue(first(properties, 'SUMMARY'), limits) ?? '',
    due: parseCalendarTime(first(properties, 'DUE')),
    status,
    completed: status?.toUpperCase() === 'COMPLETED' || properties.has('COMPLETED'),
  };
}

/**
 * Visits each wanted component with its own properties: an alarm's description inside an event is
 * not the event's. Lines outside any wanted component go to `root`. Returns whether `visit` stopped
 * the walk.
 */
function walkComponents(
  lines: string[],
  wanted: ReadonlySet<string>,
  visit: (name: string, properties: Properties) => boolean,
  root?: (line: ContentLine) => void,
): boolean {
  const stack: string[] = [];
  let current: { name: string; depth: number; properties: Properties } | undefined;
  for (const text of lines) {
    const line = parseContentLine(text);
    if (!line) continue;
    const component = line.value.trim().toUpperCase();
    if (line.name === 'BEGIN') {
      stack.push(component);
      if (!current && wanted.has(component))
        current = { name: component, depth: stack.length, properties: new Map() };
    } else if (line.name === 'END') {
      const open = stack.lastIndexOf(component);
      if (open < 0) continue;
      stack.length = open;
      if (current && open < current.depth) {
        const more = visit(current.name, current.properties);
        current = undefined;
        if (!more) return true;
      }
    } else if (current && stack.length === current.depth) {
      const named = current.properties.get(line.name);
      if (named) named.push(line);
      else current.properties.set(line.name, [line]);
    } else if (!current && root) root(line);
  }
  return false;
}

export function parseCalendar(text: string, limits = cardLimits): Calendar {
  const unfolded = unfoldContentLines(text, limits.lines);
  const events: CalendarEvent[] = [];
  const todos: CalendarTodo[] = [];
  let name: string | undefined;
  const stopped = walkComponents(
    unfolded.lines,
    new Set(['VEVENT', 'VTODO']),
    (component, properties) => {
      if (events.length + todos.length >= limits.entries) return false;
      if (component === 'VEVENT') events.push(calendarEvent(properties, limits));
      else todos.push(calendarTodo(properties, limits));
      return true;
    },
    (line) => {
      if (line.name === 'X-WR-CALNAME' && !name) name = textValue(line, limits);
    },
  );
  const order = (event: CalendarEvent) =>
    event.start ? calendarSortKey(event.start) : Number.POSITIVE_INFINITY;
  events.sort((a, b) => order(a) - order(b));
  return { kind: 'calendar', name, events, todos, truncated: unfolded.truncated || stopped };
}

// Contacts

/** Apple wraps its standard labels: `_$!<Mobile>!$_`. */
const appleLabel = (value: string) => value.replace(/^_\$!<(.*)>!\$_$/, '$1');

function contactValue(
  line: ContentLine,
  value: string,
  properties: Properties,
  limits: CardLimits,
): ContactValue {
  const types = (line.parameters.TYPE ?? [])
    .flatMap((type) => type.split(','))
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type && !noiseTypes.has(type));
  const grouped = line.group
    ? properties.get('X-ABLABEL')?.find((item) => item.group === line.group)
    : undefined;
  const label = textValue(grouped, limits);
  return {
    value: value.slice(0, limits.value),
    types: [...new Set(types)],
    label: label ? appleLabel(label) : undefined,
  };
}

function address(line: ContentLine): string {
  const label = line.parameters.LABEL?.[0]?.trim();
  if (label) return label;
  const parts = splitValue(rawValue(line), ';').map((part) =>
    splitValue(part, ',')
      .map((item) => unescapeText(item).trim())
      .filter(Boolean),
  );
  const [
    box = [],
    extended = [],
    street = [],
    locality = [],
    region = [],
    code = [],
    country = [],
  ] = parts;
  // `Cluj-Napoca, CJ 400000`: the locality, then the region and postal code
  const regionAndCode = [region.join(', '), code.join(' ')].filter(Boolean).join(' ');
  const place = [locality.join(', '), regionAndCode].filter(Boolean).join(', ');
  const lines = [...box, ...extended, ...street, place, country.join(', ')];
  return lines.filter(Boolean).join('\n');
}

function contactDate(line: ContentLine | undefined): ContactDate | undefined {
  if (!line) return undefined;
  const value = unescapeText(rawValue(line)).trim();
  const full = /^(\d{4})-?(\d{2})-?(\d{2})(?:T|$)/.exec(value);
  const partial = /^--(\d{2})-?(\d{2})$/.exec(value);
  const valid = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31;
  if (full && valid(Number(full[2]), Number(full[3])))
    return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  if (partial && valid(Number(partial[1]), Number(partial[2])))
    return { month: Number(partial[1]), day: Number(partial[2]) };
  return value ? { text: value.slice(0, 200) } : undefined;
}

function photo(line: ContentLine | undefined, limits: CardLimits): string | undefined {
  if (!line) return undefined;
  const value = unescapeText(line.value).replace(/\s+/g, '');
  const uri = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/i.exec(value);
  const encoding = line.parameters.ENCODING?.[0]?.toUpperCase();
  const declared = (line.parameters.TYPE ?? line.parameters.MEDIATYPE ?? [])
    .map((type) => type.toUpperCase().replace(/^IMAGE\//, ''))
    .find((type) => Object.hasOwn(photoTypes, type));
  const type = uri ? uri[1]!.toLowerCase() : declared && photoTypes[declared];
  const data = uri ? uri[2]! : encoding === 'B' || encoding === 'BASE64' ? value : '';
  if (!type || !data || data.length > limits.photo || !base64.test(data)) return undefined;
  return `data:${type};base64,${data}`;
}

function contact(properties: Properties, limits: CardLimits): Contact {
  const structured = first(properties, 'N');
  const [family, given, additional, prefix, suffix] = structured
    ? splitValue(rawValue(structured), ';').map((part) =>
        splitValue(part, ',')
          .map((item) => unescapeText(item).trim())
          .filter(Boolean)
          .join(' '),
      )
    : [];
  const composed = [prefix, given, additional, family, suffix].filter(Boolean).join(' ');
  const organization = first(properties, 'ORG');
  const values = (name: string, value: (line: ContentLine) => string) =>
    (properties.get(name) ?? [])
      .map((line) => contactValue(line, value(line), properties, limits))
      .filter((item) => item.value);
  return {
    name: textValue(first(properties, 'FN'), limits) ?? (composed || undefined),
    organization: organization
      ? splitValue(rawValue(organization), ';')
          .map((part) => unescapeText(part).trim())
          .filter(Boolean)
          .join(', ') || undefined
      : undefined,
    title:
      textValue(first(properties, 'TITLE'), limits) ?? textValue(first(properties, 'ROLE'), limits),
    emails: values('EMAIL', (line) =>
      unescapeText(rawValue(line))
        .replace(/^mailto:/i, '')
        .trim(),
    ),
    phones: values('TEL', (line) => unescapeText(rawValue(line)).replace(/^tel:/i, '').trim()),
    addresses: values('ADR', address),
    birthday: contactDate(first(properties, 'BDAY')),
    note: textValue(first(properties, 'NOTE'), limits),
    photo: photo(first(properties, 'PHOTO'), limits),
  };
}

export function parseContacts(text: string, limits = cardLimits): ContactBook {
  const unfolded = unfoldContentLines(text, limits.lines);
  const contacts: Contact[] = [];
  const stopped = walkComponents(unfolded.lines, new Set(['VCARD']), (_, properties) => {
    if (contacts.length >= limits.entries) return false;
    contacts.push(contact(properties, limits));
    return true;
  });
  return { kind: 'contacts', contacts, truncated: unfolded.truncated || stopped };
}

/** What a `.ics` or `.vcf` holds, decided by its content: its first BEGIN, or a VCF header. */
export function readCards(text: string, limits = cardLimits): CardDocument {
  if (isVariantCallFormat(text)) return { kind: 'variant-calls' };
  const begin = /^BEGIN:(VCALENDAR|VCARD)[ \t]*\r?$/im.exec(text.slice(0, 64 * 1024));
  const kind = begin?.[1]?.toUpperCase();
  if (kind === 'VCALENDAR') return parseCalendar(text, limits);
  if (kind === 'VCARD') return parseContacts(text, limits);
  return { kind: 'unknown' };
}
