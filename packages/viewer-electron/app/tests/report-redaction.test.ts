import { describe, expect, it } from 'vitest';
import { redactReport } from '../src/domain/diagnostics/report-redaction';
import type { ReportPrivateValue } from '../src/domain/diagnostics/report-redaction';

const home = '/Home/Zoë Sample';
const privateValues: ReportPrivateValue[] = [
  { kind: 'home', value: home },
  { kind: 'short name', value: 'art' },
  { kind: 'full name', value: 'Zoë Sample' },
  { kind: 'computer name', value: "Zoë's Art Mac" },
  { kind: 'local host name', value: 'Zoes-Art-Mac' },
  { kind: 'Bonjour name', value: 'Zoes-Art-Mac.local' },
  { kind: 'volume name', value: 'Sample Disk' },
  { kind: 'application bundle', value: '/Applications/Viewer.app' },
  { kind: 'application data', value: home + '/Library/Application Support/Viewer' },
];

describe('shareable report redaction', () => {
  it.each(['', '/private', '/System/Volumes/Data', '/private/System/Volumes/Data'])(
    'hides Home and all descendant names under %s, retaining only depth and extension',
    (prefix) => {
      const file = prefix + home + '/Medical Records/Diagnosis.pdf';
      for (const spelling of [file, encodeURI(file), encodeURIComponent(file), file.normalize('NFD')]) {
        expect(redactReport('Failed: ' + spelling, privateValues)).toBe('Failed: ~/…/….pdf');
        expect(redactReport('Failed: file://' + spelling, privateValues)).toBe('Failed: ~/…/….pdf');
      }
      expect(redactReport(prefix + home + '/', privateValues)).toBe('~');
      expect(redactReport(prefix + home, privateValues)).toBe('~');
    },
  );

  it('does not guess where a path with spaces, quotes or punctuation ends', () => {
    const file = home + '/Parent (sample)/A "sensitive" child/Part of name.pdf';
    expect(redactReport(file, privateValues)).toBe('~/…/…/….pdf');
    expect(redactReport(file + ' failed with a private description', privateValues)).toBe('~/…/…/….pdf');
  });

  it('keeps names within Viewer bundle and data paths, including their alternate roots', () => {
    expect(redactReport('/Applications/Viewer.app/Contents/Resources/app.asar', privateValues)).toBe('/Applications/Viewer.app/Contents/Resources/app.asar');
    for (const prefix of ['', '/private', '/System/Volumes/Data']) {
      const file = prefix + home + '/Library/Application Support/Viewer/Logs/diagnostics.log';
      expect(redactReport('Read ' + encodeURI(file), privateValues)).toBe('Read ~/Library/Application Support/Viewer/Logs/diagnostics.log');
    }
    expect(redactReport(home + '/Library/Application Support/Viewer-other/private.txt', privateValues)).toBe('~/…/…/…/….txt');
  });

  it('removes whole names in all cases and path parts, preserving longer words', () => {
    expect(redactReport('art ART Art /art/file artist cart earth smart', privateValues)).toBe('<private> <private> <private> /<private>/file artist cart earth smart');
    expect(redactReport('ZOË SAMPLE and zoë sample', privateValues)).toBe('<private> and <private>');
  });

  it('replaces overlapping private values longest first, including apostrophes and .local', () => {
    const values: ReportPrivateValue[] = [
      { kind: 'short name', value: 'art' },
      { kind: 'computer name', value: "Art's Mac" },
      { kind: 'full name', value: "Art's Mac Studio" },
    ];
    expect(redactReport("ART'S MAC STUDIO; Art's Mac.local; Art", values)).toBe('<private>; <private>; <private>');
    expect(redactReport("Zoë's Art Mac Zoes-Art-Mac.local", privateValues)).toBe('<private> <private>');
  });

  it.each([
    '/Volumes/Sample Disk/Confidential/report.pdf',
    '/System/Volumes/Data/Volumes/Sample%20Disk/Report.pdf',
    'smb://person:password@server.example.invalid/Private Share/plan.pdf',
    'afp://server.example.invalid/PrivateShare',
    'nfs://192.168.2.4/SecretShare',
    '\\\\office-server\\secret-share\\plan.pdf',
    '/Network/Servers/office-server/secret-share/plan.pdf',
  ])('hides volume and network locations: %s', (text) => {
    expect(redactReport(text, privateValues)).not.toMatch(/Sample|Confidential|person|password|server|Share|plan|192\.168/i);
  });

  it('redacts IPv4, IPv6, mapped addresses, zone identifiers and local host names', () => {
    const text = '192.168.2.4 [fe80::abcd:1%en0] 2001:db8::8 ::1 ::ffff:192.0.2.128 office.local';
    expect(redactReport(text, privateValues)).not.toMatch(/192|fe80|db8|::|en0|office/);
    expect(redactReport('2026-11-01T12:34:56.000Z', [])).toBe('2026-11-01T12:34:56.000Z');
  });

  it('removes emails, license keys, prefixed and unlabelled tokens and address queries', () => {
    const secret = 'AbCd0123456789_AbCd0123456789_AbCd0123456789';
    const text = [
      'generated+support@example.invalid',
      'viewer-license-1.eyJmb28iOiJiYXIifQ.signature',
      'sk-proj-abcdefghijklmnop',
      secret,
      'api_key=short-secret',
      'Authorization: Bearer short-secret',
      'https://server.example.invalid/help?email=hidden%40example.invalid&secret=another#fragment',
    ].join('\n');
    const result = redactReport(text, privateValues);
    expect(result).not.toMatch(/generated|example\.invalid|viewer-license|eyJ|signature|abcdefghijklmnop|AbCd|short-secret|hidden|another|fragment|\?/);
    expect(result).toContain('https://<host>/help');
  });

  it('leaves ordinary text without private values unchanged', () => {
    const text = 'Renderer failed to load.\nRetry with 2 displays at 2×.\n';
    expect(redactReport(text, [])).toBe(text);
    expect(redactReport(text, privateValues)).toBe(text);
  });

  it('fails closed for missing identities and still-concealed encodings', () => {
    const result = redactReport('Some unknown host might occur anywhere here.', [{ kind: 'computer name', value: undefined }]);
    expect(result).toBe('[Text omitted: computer name could not be checked.]');
    expect(redactReport('private %252525252541 value', privateValues)).toBe('[Encoded text omitted]');
  });

  it('never leaves any known identity in deterministic random mixtures', () => {
    const identities = privateValues.filter((item) => !['application bundle', 'application data'].includes(item.kind));
    let seed = 0x5eed;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let trial = 0; trial < 300; trial++) {
      const pieces: string[] = [];
      for (let count = 0; count < 12; count++) {
        const value = identities[next() % identities.length]!.value!;
        const variant = next() % 4;
        pieces.push(variant === 0 ? value.toUpperCase() : variant === 1 ? encodeURIComponent(value) : variant === 2 ? value.normalize('NFD') : value);
        pieces.push([' filler ', '\n', ' (noise) ', ' / '][next() % 4]!);
      }
      const result = redactReport(pieces.join(''), privateValues).toLocaleLowerCase();
      for (const item of identities) expect(result).not.toContain(item.value!.toLocaleLowerCase());
    }
  });
});
