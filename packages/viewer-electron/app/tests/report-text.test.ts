import { describe, expect, it } from 'vitest';
import { reportFailure } from '../src/domain/diagnostics/report-failure';
import { redactReport } from '../src/domain/diagnostics/report-redaction';
import { redactSecrets } from '../src/desktop/diagnostics/failures';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DiagnosticLog } from '../src/desktop/diagnostics/diagnostics';
import { temporaryRoot } from '../tools/temporary';
import type { ReportPrivateValue } from '../src/domain/diagnostics/report-redaction';

const values: ReportPrivateValue[] = [
  { kind: 'home', value: '/Users/zoe' },
  { kind: 'short name', value: 'zoe' },
  { kind: 'full name', value: 'Zoë Sample' },
  { kind: 'computer name', value: 'Zoes-MacBook-Pro' },
  { kind: 'application bundle', value: '/Applications/Viewer.app' },
];

const controlRows = [
  ['Owner:\tzoe\tGroup:\tstaff', 'Owner: <private> Group: staff'],
  ['host Zoes-MacBook-Pro\tonline', 'host <private> online'],
  ['\u001b[31mzoe\u001b[0m failed', '<private> failed'],
  ['user zoe\u000bPayroll', 'user <private> Payroll'],
] as const;

const terminalSequences = [
  '\u001b[31m',
  '\u001b[38;2;255;128;0m',
  '\u001b[?25l',
  '\u001b[3\u00001m',
  '\u001b[3\n1m',
  '\u001b[31\u200dm',
  '\u001b[31\u0018',
  '\u001b[31\u001a',
  '\u009b31m',
  '\u001b]0;Private terminal title\u0007',
  '\u001b]8;;https://private.example/secret\u001b\\',
  '\u009d0;Private terminal title\u009c',
  '\u001bPprivate payload\u001b\\',
  '\u001bXprivate payload\u001b\\',
  '\u001b^private payload\u001b\\',
  '\u001b_private payload\u001b\\',
  '\u0090private payload\u009c',
  '\u0098private payload\u009c',
  '\u009eprivate payload\u009c',
  '\u009fprivate payload\u009c',
  '\u001b7',
  '\u001b8',
  '\u001b(B',
  '\u001b#8',
  '\u001bc',
  '\u001b=',
  '\u001b>',
  '[31m',
  '[0m',
];

describe('readable optional report text', () => {
  it.each(["O'Malley", 'O’Malley', 'O‘Malley', "𐐀'Malley"])(
    'keeps an internal apostrophe inside the path (%s)',
    (name) => {
      expect(redactReport('open /Users/Shared/Clients/' + name, values)).toBe(
        'open <path>/…/…/…/…',
      );
      expect(
        redactReport('open /Users/Shared/Clients/' + name + ' Family/Results.pdf', values),
      ).toBe('open <path>/…/…/…/…');
      expect(
        redactReport('open "/Users/Shared/Clients/' + name + ' Family/Results.pdf"', values),
      ).toBe('open <path>/…/…/…/…/….pdf');
    },
  );

  it.each(['\n', '\r\n', '\r'])('keeps a separator between ordinary lines (%j)', (separator) => {
    const input = ['Save failed', 'The disk is full', 'Try again'].join(separator);
    expect(redactReport(input, values)).toBe('Save failed\nThe disk is full\nTry again');
  });

  it.each([
    ['user z\u200doe', 'user <private>'],
    ['user Sam\u200cple', 'user <private>'],
    ['host Zoes-Mac\tBook-Pro', 'host <private>'],
    ['host Zoes-Mac\t\u000bBook-Pro', 'host <private>'],
  ])('normalizes joining and control characters before matching names (%s)', (input, expected) => {
    expect(redactReport(input, values)).toBe(expected);
  });

  it.each(controlRows)('redacts a name beside separating controls (%j)', (input, expected) => {
    expect(redactReport(input, values)).toBe(expected);
    expect(redactReport(redactSecrets(input), values)).toBe(expected);
  });

  it.each(terminalSequences)('removes the whole terminal sequence (%j)', (sequence) => {
    const input = sequence + 'zoe\u001b[0m failed';
    expect(redactSecrets(input)).toBe('zoe failed');
    expect(redactReport(input, values)).toBe('<private> failed');
    expect(redactReport(redactSecrets(input), values)).toBe('<private> failed');
  });

  it.each(['\u0000', '\u0008', '\t', '\u000b', '\u000c', '\u007f', '\u0085'])(
    'keeps separating controls between words (%j)',
    (separator) => {
      const input = 'user zoe' + separator + 'Payroll';
      expect(redactSecrets(input)).toBe('user zoe Payroll');
      expect(redactReport(input, values)).toBe('user <private> Payroll');
    },
  );

  it.each(['\u001b]title', '\u001bPpayload', '\u009fcontent'])(
    'omits an unterminated terminal string through the bounded end (%j)',
    (sequence) => {
      expect(redactSecrets('before ' + sequence)).toBe('before ');
      expect(redactReport('before ' + sequence, values)).toBe('before ');
    },
  );

  it('recognizes credentials decorated with terminal sequences', () => {
    const input = 'token=\u001b[31mabc\u001b[0m next line kept';
    expect(redactSecrets(input)).toBe('token=[redacted]');
    expect(redactReport(input, values)).toBe('token=[redacted]');
  });

  it.each(['token', 'password', 'cookie', 'authorization'])(
    'ends an unquoted %s value at its line break',
    (key) => {
      const input = key + '=abc\nnext line kept';
      const expected = key + '=[redacted]\nnext line kept';
      expect(redactSecrets(input)).toBe(expected);
      expect(redactReport(input, values)).toBe(expected);
    },
  );

  it('preserves the word after the reported credential example', () => {
    expect(redactSecrets('token=abc\nnext line kept?')).toBe('token=[redacted]\nnext line kept?');
  });

  it.each(['\n', '\r\n', '\r', '\t', ' '])(
    'redacts a bearer credential across its separator (%j)',
    (separator) => {
      const input = 'Bearer' + separator + 'abcdef123456\nnext line kept';
      const logSeparator = separator === '\t' ? ' ' : separator;
      expect(redactSecrets(input)).toBe('Bearer' + logSeparator + '[redacted]\nnext line kept');
      const normalized = separator === '\t' ? ' ' : separator.replace(/\r\n?/g, '\n');
      expect(redactReport(input, values)).toBe(
        'Bearer' + normalized + '[redacted]\nnext line kept',
      );
    },
  );

  it('keeps quoted credential spans without losing text beyond their closing quote', () => {
    const input = 'password="first\nsecond"\nnext line kept';
    const expected = 'password=[redacted]\nnext line kept';
    expect(redactSecrets(input)).toBe(expected);
    expect(redactReport(input, values)).toBe(expected);
  });

  it.each(['\n', '\r\n'])('retains coordinates only from a recorded stack (%j)', (separator) => {
    const frame = '    at FolderService.list (/Applications/Viewer.app/Contents/main.js:12:76)';
    const input = 'Error: stopped' + separator + frame;
    expect(redactReport(input, values)).toBe('<path>/…/…/…/…/…');
    expect(reportFailure({ detail: input }, '/Applications/Viewer.app').frames).toEqual([]);
    expect(
      reportFailure({ detail: input, stack: frame + separator }, '/Applications/Viewer.app').frames,
    ).toEqual([{ path: 'Contents/main.js', line: 12, column: 76 }]);
  });

  it('reduces a bare bundle path with unverified coordinates', () => {
    const input = '/Applications/Viewer.app/Contents/Private.js:12:76';
    expect(redactReport(input, values)).toBe('<path>/…/…/…/…');
  });

  it.each(['12:04:00', '00:00:00', '23:59:59.123', '12:76'])(
    'does not mistake a time or line and column for an address (%s)',
    (value) => {
      expect(redactReport('Stopped at ' + value, values)).toBe('Stopped at ' + value);
    },
  );

  it.each(['intranet:8080', '192.168.1.20:445', '2001:0:0:0:0:0:0:1', '[fe80::1%25en0]:445'])(
    'still removes network addresses (%s)',
    (address) => {
      expect(redactReport('connect ' + address, values)).toBe('connect <address>');
    },
  );

  it('persists readable boundaries while redacting credentials on either side of a line break', async () => {
    const root = await temporaryRoot('viewer-report-line-breaks-');
    const log = new DiagnosticLog(path.join(root, 'diagnostics.log'));
    await log.record(
      'renderer-error',
      'می‌خواهم\ntoken=abc\nnext line kept?\nBearer\nabcdef123456',
    );
    const entry = JSON.parse((await readFile(log.file, 'utf8')).trim());
    expect(entry.detail).toBe('می‌خواهم\ntoken=[redacted]\nnext line kept?\nBearer\n[redacted]');
  });

  it('redacts the reported control rows after an actual log write', async () => {
    const root = await temporaryRoot('viewer-report-terminal-controls-');
    const log = new DiagnosticLog(path.join(root, 'diagnostics.log'));
    for (const [input] of controlRows) await log.record('renderer-error', input);
    const entries = (await readFile(log.file, 'utf8')).trim().split('\n');
    expect(entries.map((line) => redactReport(JSON.parse(line).detail, values))).toEqual(
      controlRows.map(([, expected]) => expected),
    );
  });
});
