import { licensePayload, licenseSignature } from './support/diagnostic-license';
import { describe, expect, it } from 'vitest';
import { redactReport } from '../src/domain/diagnostics/report-redaction';
import type { ReportPrivateValue } from '../src/domain/diagnostics/report-redaction';

const home = '/Users/zoe';
const values: ReportPrivateValue[] = [
  { kind: 'home', value: home },
  { kind: 'home', value: '/People/Home With Spaces' },
  { kind: 'home', value: '/People/Zoë Example' },
  { kind: 'short name', value: 'art' },
  { kind: 'short name', value: 'zoe' },
  { kind: 'full name', value: 'Zoë Example' },
  { kind: 'computer name', value: "Example's Research Computer" },
  { kind: 'local host name', value: 'example-research-computer' },
  { kind: 'Bonjour name', value: 'research_machine.example.local' },
  { kind: 'volume name', value: 'Sample Disk' },
  { kind: 'application bundle', value: '/Applications/Viewer.app' },
  { kind: 'application data', value: home + '/Library/Application Support/Viewer' },
];

describe('optional message redaction', () => {
  it.each([
    ["file='Project Notes'", '<quoted text>'],
    ["open('Project Notes')", '<quoted text>'],
    ['open(file=“Project Notes”)', '<quoted text>'],
    ['stat: Project Notes\n/Users/zoe/end', '~/…'],
    ['Project Notes\n/Applications/Viewer.app/Private.js', '<path>/…/…/….js'],
    ['read Project Notes\n/People/Home With Spaces/end', 'read ~/…'],
    ["open Parents'/secret.txt", 'open <path>/…/….txt'],
    ['open Sample Folder!/secret.txt', 'open <path>/…/….txt'],
    ["open 'Parents' Sample Folder'", 'open <quoted text>'],
    ['open "2026" Sample File.txt"', 'open <quoted text>'],
    ['Private Name!/secret.txt', '<path>/…/….txt'],
    ['open Private Name /leaf.txt', 'open <path>/….txt'],
    ['open Private "Name/leaf.txt"', 'open <path>/…/….txt'],
  ])('hides an ambiguous first component or basename in %s', (message, expected) => {
    expect(redactReport(message, values)).toBe(expected);
  });
  it('omits a private relative prefix before a frame-shaped filename', () => {
    const message = 'Project Notes\n    at Private Name (/Applications/Viewer.app/Private.js:1:2)';
    expect(redactReport(message, values)).not.toMatch(/Project|Notes|Private|Name/);
  });

  it('leaves ordinary text without private values unchanged', () => {
    const text = 'The operation failed. Please try again.';
    expect(redactReport(text, values)).toBe(text);
  });

  it('removes a longer private value before one contained inside it', () => {
    const privateValues: ReportPrivateValue[] = [
      { kind: 'short name', value: 'Example' },
      { kind: 'computer name', value: 'Example Research Computer' },
    ];
    expect(redactReport('Example Research Computer Example', privateValues)).toBe(
      '<private> <private>',
    );
  });

  it.each([
    '/Users/zoe/Documents/Diagnosis.pdf',
    '/private/Users/zoe/Documents/Diagnosis.pdf',
    '/System/Volumes/Data/Users/zoe/Documents/Diagnosis.pdf',
    '/private/System/Volumes/Data/Users/zoe/Documents/Diagnosis.pdf',
    'file:///Users/zoe/Documents/Diagnosis.pdf',
    encodeURI('/Users/zoe/Documents/Diagnosis.pdf'),
    encodeURIComponent('/Users/zoe/Documents/Diagnosis.pdf'),
    '\\/Users\\/zoe\\/Documents\\/Diagnosis.pdf',
    '\\u002fUsers\\u002fzoe/Documents/Diagnosis.pdf',
    '~/Documents/Diagnosis.pdf',
    '~zoe/Documents/Diagnosis.pdf',
    '$HOME/Documents/Diagnosis.pdf',
    '\x24{HOME}/Documents/Diagnosis.pdf',
    '/Users//zoe/./Documents/Diagnosis.pdf',
    '/Users/zo\ne/Documents/Diagnosis.pdf',
    '/Users/z\u0000oe/Documents/Diagnosis.mp4',
    '/Users/z\u200boe/Documents/Diagnosis.pdf',
    'C:\\Users\\zoe\\Documents\\Diagnosis.pdf',
    'Macintosh HD:Users:zoe:Documents:Diagnosis.pdf',
    '/People/Home With Spaces/Documents/Diagnosis.pdf',
    '/People/Home+With+Spaces/Documents/Diagnosis.pdf',
    '/People/Home-With-Spaces/Documents/Diagnosis.pdf',
    '/People/Home_With_Spaces/Documents/Diagnosis.pdf',
    '/People/Zoë Example/Documents/Diagnosis.pdf',
    encodeURI('/People/Zoë Example/Documents/Diagnosis.pdf'),
    '/People/Zoë Example/Documents/Diagnosis.pdf'.normalize('NFD'),
  ])('hides every tested home spelling: %s', (injected) => {
    const result = redactReport('open ' + injected, values);
    expect(result).not.toContain(injected);
    expect(result).not.toMatch(/Diagnosis|Documents|zoe|Home.With.Spaces|Macintosh HD/i);
    expect(() => encodeURIComponent(result)).not.toThrow();
  });

  it.each([';', '|', '=', '!', '\t', '\n', ',', ')'])(
    'hides a home with any terminator (%s)',
    (terminator) => {
      expect(redactReport('/People/Home With Spaces' + terminator, values)).not.toContain('Home');
    },
  );

  it.each([
    '/Users/Shared/Client Acme/Payroll 2026',
    '/Users/another/Medical Records/Diagnosis.pdf',
    '/tmp/SecretProject/secret.txt',
    '/net/private-server/SecretProject',
    '//old-server/unmounted-share/SecretProject',
    '"Documents/Medical Records/Diagnosis.pdf"',
    "'Documents/Medical Records/Diagnosis.pdf'",
    '"/Volumes/No Longer Mounted/SecretProject/file.txt"',
  ])('reduces absolute and quoted relative paths: %s', (injected) => {
    const result = redactReport('open ' + injected, values);
    expect(result).not.toContain(injected);
    expect(result).not.toMatch(
      /Acme|Payroll|another|Medical|Diagnosis|SecretProject|old-server|unmounted-share|No Longer Mounted/,
    );
  });

  it('gets an extension from the path, never from a later word on the line', () => {
    const result = redactReport('open /Users/zoe/Documents/x.pdf failed, pin 4821.hunter2', values);
    expect(result).toBe('open ~/…/….pdf');
    expect(result).not.toContain('hunter2');
  });

  it('hides every component of adversarial names in each recognized path form', () => {
    const quotes = [
      ["'", "'"],
      ['"', '"'],
      ['\x60', '\x60'],
      ['‘', '’'],
      ['“', '”'],
      ['«', '»'],
    ];
    const letters = 'Z9 漢字 Café 2048';
    const names = [
      letters,
      "Parents' Confidential Records",
      "2026's Confidential Budget",
      '12" Secret Blueprint',
      '2026',
      '!?[]{}.,;@#%+=' + quotes.flat().join(''),
      'Private\n    at Another Private Name',
    ];
    for (const quote of new Set(quotes.flat())) {
      for (let index = 0; index <= letters.length; index++) {
        names.push(letters.slice(0, index) + quote + letters.slice(index));
      }
    }
    for (const name of names) {
      const relative = name + '/' + name + '.pdf';
      const absolute = home + '/' + relative;
      const messages = [
        absolute,
        '/private' + absolute,
        '/System/Volumes/Data' + absolute,
        '~/' + relative,
        '$HOME/' + relative,
        '\x24{HOME}/' + relative,
        'C:/Projects/' + relative,
        'C:\\Projects\\' + relative.replaceAll('/', '\\'),
        '/Volumes/Sample Disk/' + relative,
        home + '/Library/Application Support/Viewer/' + relative,
        './Projects/' + relative,
        relative,
        'Projects/' + relative,
        'file://' + absolute,
        encodeURIComponent(absolute),
        'getaddrinfo ENOTFOUND ' + absolute,
        'https://private.example/' + relative,
        'private.example/' + relative,
        'data:text/plain,' + relative,
        "'/Applications/Viewer.app/" + relative + "'",
        '<Viewer>/' + relative,
        ...quotes.flatMap(([open, close]) => [
          open + absolute + close,
          open + relative + close,
          open + absolute + close + ' private tail',
          open + absolute,
        ]),
      ];
      for (const message of messages) {
        const excerpt = redactReport('open ' + message, values);
        expect(excerpt, JSON.stringify(message)).toMatch(
          /^open (?:getaddrinfo ENOTFOUND )?(?:(?:~|\.?<path>|<Viewer data>|\/Volumes\/<volume>)(?:\/…)*(?:\.pdf)?|<address>|<data>|<token>|\[Encoded text omitted\])$/,
        );
      }
    }
  });

  it('keeps bundle code names, only fixed data folders and no named lens', () => {
    expect(redactReport('/Applications/Viewer.app/Contents/Resources/app.asar', values)).toBe(
      '<Viewer>/Contents/Resources/app.asar',
    );
    const data = home + '/Library/Application Support/Viewer';
    expect(redactReport(data + '/Logs/diagnostics.log', values)).toBe('<Viewer data>/Logs/….log');
    expect(redactReport(data + '/lenses/Private Client.json', values)).not.toMatch(
      /Private|Client/,
    );
    expect(redactReport(data + '/../../PrivateClient.txt', values)).not.toContain('PrivateClient');
    expect(redactReport(data + '-other/PrivateClient.txt', values)).not.toContain('PrivateClient');
  });

  it('handles individual full-name words, apostrophes, host labels and NetBIOS names', () => {
    const result = redactReport(
      'ZOË Example art_1 2ART artist cart Example’s Research Computer research_machine RESEARCH_MACHIN',
      values,
    );
    expect(result).not.toMatch(/ZOË|Example|art_1|2ART|research_machine|RESEARCH_MACHIN/i);
    expect(result).toContain('artist cart');
    expect(redactReport("Example's Research Computer.local", values)).not.toContain('Example');
  });

  it.each([
    'get https://intranet.example.com/wiki/Secret_Project',
    'first https://first.example/Secret_Project second https://second.example/Secret_Second?q=hidden#fragment',
    'smb://person:password@private_server/Private Share/Secret_Project',
    'afp://server/Secret_Project',
    'nfs://server/Secret_Project',
    'get https://private_host/Secret_Project',
    'user@private_host',
    'https://münchen.example/Secret_Project',
    'münchen.example/Secret_Project?q=hidden#fragment',
    'route?hidden=Secret_Project#fragment',
    '00:1A:2B:3C:4D:5E',
    '192.168.2.4 [fe80::abcd:1%en0] 2001:db8::8 ::1 ::ffff:192.0.2.128',
  ])('drops addresses and URL paths: %s', (injected) => {
    const result = redactReport(injected, values);
    expect(result).not.toContain(injected);
    expect(result).not.toMatch(
      /Secret_Project|Secret_Second|private_host|private_server|person|password|hidden|fragment|1A:2B|192\.168|fe80|db8|::|münchen/,
    );
  });

  it.each([
    'DB_PASSWORD=hunter2',
    'client_secret="several private words"',
    "MYAPP_API_KEY='several private words'",
    'passwd=hunter2 pwd=hunter2 pass: hunter2',
    '-u user:hunter2',
    '--password "several private words"',
    'Cookie: session=hunter2; another=private-cookie',
    'Set-Cookie: session=hunter2; HttpOnly',
    'Authorization: Basic ZXhhbXBsZTpwYXNz',
    'Proxy-Authorization: Bearer private-token',
    `“viewer-license-1.\n  ${licensePayload}.\n  ${licenseSignature}”`,
    `“vie\n wer- license -1.\n ${licensePayload}.\n ${licenseSignature}”`,
    'AKIAIOSFODNN7EXAMPLE',
    'AbCd1234/AbCd1234/AbCd1234/AbCd1234/AbCd1234=',
    'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImFiYyJ9.abcdefghijklmno',
  ])('redacts recognized credentials: %s', (injected) => {
    expect(redactReport(injected, values)).not.toMatch(
      /hunter2|several|private words|private-cookie|private-token|ZXhhb|eyJ|abcdefghijk|AKIA|AbCd1234/,
    );
  });

  it('applies address masking to every optional line, including frame-shaped message text', () => {
    expect(
      redactReport(
        'Error: failed\n    at FolderService.list (/Applications/Viewer.app/Contents/app.cjs:12:3)',
        values,
      ),
    ).not.toContain('FolderService.list');
  });

  it('fails closed for missing checks and bounds overlarge inputs before scanning', () => {
    expect(redactReport('private', [{ kind: 'computer name', value: undefined }])).toContain(
      'could not be checked',
    );
    expect(redactReport('a'.repeat(64000), values).length).toBeLessThan(8000);
    expect(redactReport('private %252525252541 value', values)).toContain('Encoded text omitted');
  });

  it('searches for the spelling actually injected, plus its canonical private value', () => {
    let seed = 0x5eed;
    for (let index = 0; index < 300; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 'Sample Person' + seed.toString(36);
      const privateValues: ReportPrivateValue[] = [{ kind: 'full name', value }];
      for (const injected of [
        value,
        value.toUpperCase(),
        encodeURIComponent(value),
        '\\u0053' + value.slice(1),
      ]) {
        const result = redactReport('before ' + injected + ' after', privateValues);
        expect(result.toLowerCase()).not.toContain(injected.toLowerCase());
        expect(result.toLowerCase()).not.toContain(value.toLowerCase());
        expect(result).toBe('before <private> after');
      }
    }
  });

  it('removes every exact injected spelling from seeded random mixes of values and filler', () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let round = 0; round < 200; round++) {
      const privateValues: ReportPrivateValue[] = [];
      const injections: string[] = [];
      for (let index = 0; index < 8; index++) {
        const value = 'Sample Person' + random().toString(36);
        privateValues.push({ kind: 'full name', value });
        const spellings = [value, value.toUpperCase(), encodeURIComponent(value)];
        injections.push(spellings[random() % spellings.length]!);
      }
      const text = injections.map((value) => 'filler ' + value + ' more filler').join(' ');
      const result = redactReport(text, privateValues);
      for (const injected of injections) expect(result).not.toContain(injected);
      for (const { value } of privateValues) expect(result).not.toContain(value);
      expect(result).toBe(injections.map(() => 'filler <private> more filler').join(' '));
    }
  });
});
