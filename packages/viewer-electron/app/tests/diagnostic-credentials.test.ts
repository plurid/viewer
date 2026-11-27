import { licensePayload, licenseSignature } from './support/diagnostic-license';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiagnosticLog } from '../src/desktop/diagnostics/diagnostics';
import {
  DiagnosticBudget,
  MainFailures,
  WorkerOutput,
  recordConsoleErrors,
} from '../src/desktop/diagnostics/failures';
import { readLicenseKey } from '../src/desktop/license/signature';
import { shellQuote } from '../src/desktop/terminals/terminal-launch';
import { cliCommands, cliGlobalOptions } from '../src/domain/cli/catalog';
import { issueLicenseKey } from '../tools/license-key';
import { temporaryRoot } from '../tools/temporary';

type Route = 'direct' | 'service' | 'worker' | 'named-worker';
const routes: Route[] = ['direct', 'service', 'worker', 'named-worker'];

async function persisted(route: Route, messages: string[]): Promise<string[]> {
  const root = await temporaryRoot('viewer-credential-log-');
  const log = new DiagnosticLog(path.join(root, 'rows.jsonl'), 64 * 1024 * 1024);
  const writes: Promise<void>[] = [];
  for (const message of messages) {
    if (route === 'direct') writes.push(log.record('main-error', message));
    else if (route === 'service') {
      writes.push(log.record('service-error', message, undefined, 'Token'));
    } else {
      const worker = new WorkerOutput(
        route === 'named-worker' ? 'Token' : '',
        (detail, source) => writes.push(log.record('worker-output', detail, undefined, source)),
        new DiagnosticBudget(100),
      );
      const bytes = Buffer.from(message + '\n');
      for (let offset = 0; offset < bytes.length; offset += 7)
        worker.write(bytes.subarray(offset, offset + 7));
      worker.end();
    }
  }
  await Promise.all(writes);
  return (await readFile(log.file, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line).detail);
}

interface GeneratedCredential {
  message: string;
  value: string;
  open?: boolean;
}

function* recordBoundaries(): Generator<[string, string]> {
  const base = 'https://outer.invalid/?next=';
  for (const name of ['token', 'client_secret', '%74oken']) {
    for (const secret of [true, false]) {
      const field = secret ? name : 'mode';
      let url = 'https://inner.invalid/p?' + field + '=J7qxZ8mw';
      for (let depth = 0; depth <= 2; depth++) {
        const masked = url.replace('J7qxZ8mw', '[redacted]');
        yield [base + url + '&ok=1', base + (secret ? masked : url) + '&ok=1'];
        url = encodeURIComponent(url);
      }
    }
  }
  const inner = 'https://second.invalid/p?mode=simple&pwd=J7qxZ8mw&theme=light#section';
  for (const destination of [
    inner,
    'https://first.invalid/?continue=' + encodeURIComponent(inner),
  ]) {
    const encoded = encodeURIComponent(destination);
    yield [base + encoded + '&ok=1', base + encoded.replace('J7qxZ8mw', '[redacted]') + '&ok=1'];
  }
  const encodeBytes = (value: string) =>
    Array.from(Buffer.from(value), (byte) => '%' + byte.toString(16).padStart(2, '0')).join('');
  for (const encode of [encodeBytes, (value: string) => encodeURIComponent(encodeBytes(value))]) {
    const target = encode(inner);
    yield [
      base + target + '&ok=1',
      base + target.replace(encode('J7qxZ8mw'), '[redacted]') + '&ok=1',
    ];
  }
  for (const target of [
    'https://inner.invalid/p%3Ftoken%3DJ7qxZ8mw',
    'https://inner.invalid/p?to%256Ben%253DJ7qxZ8mw',
  ]) {
    yield [base + target + '&ok=1', base + target.replace('J7qxZ8mw', '[redacted]') + '&ok=1'];
  }
  for (const target of [
    'viewer:open?access_token=J7qxZ8mw',
    'mailto:help@example.invalid?auth_token=J7qxZ8mw',
  ]) {
    yield [base + target + '&ok=1', base + target.replace('J7qxZ8mw', '[redacted]') + '&ok=1'];
  }
  for (const field of ['pwd', 'mode']) {
    const destination = ' ' + inner.replace('pwd=', field + '=');
    for (const query of [
      'next=' + encodeURIComponent(destination),
      new URLSearchParams({ next: destination }).toString(),
    ]) {
      const url = 'https://outer.invalid/?' + query + '&ok=1';
      yield [url, field === 'pwd' ? url.replace('J7qxZ8mw', '[redacted]') : url];
    }
  }
  const encoded = encodeURIComponent(encodeURIComponent(encodeURIComponent(inner)));
  yield [base + encoded + '&ok=1', base + '[redacted]&ok=1'];
  const malformed = 'https://broken%xx.invalid/?token=J7qxZ8mw';
  yield [base + malformed + '&ok=1', base + '[redacted]&ok=1'];
  for (const literal of ['caption%3Dtoken%3Dready', "label=token=can't", 'Basic']) {
    yield [base + literal + '&ok=1', base + literal + '&ok=1'];
  }
  for (const field of ['token=', '--auth-token ', '--auth-token=', 'Authorization: '])
    yield [field + 'J7qxZ8mw\\', field + '[redacted]'];
  yield [
    "https://outer.invalid/?x%5ftoken=can't&ok=1",
    'https://outer.invalid/?x%5ftoken=[redacted]&ok=1',
  ];
  yield ['{"token":[}', '{"token":[redacted]'];
  for (const label of ['token', 'Authorization', 'private_key'])
    yield ['{"' + label + '":', '{"' + label + '":'];
  for (const text of [
    'Missing -----BEGIN PRIVATE KEY-----',
    'Help: -----BEGIN RSA PRIVATE KEY----- is missing.',
    'format viewer-license-1.',
    'code-signing',
    'file-watching',
    'worktree-pending',
    'unknown-setting',
    'shared-setting',
    'clean-exit',
    'main-exception',
    'main-rejection',
    'main-error',
    'service-error',
    'renderer-error',
    'renderer-gone',
    'renderer-unresponsive',
    'process-gone',
    'worker-output',
  ])
    yield [text, text];
  const catalog = [...cliGlobalOptions, ...cliCommands.flatMap((command) => command.options ?? [])];
  const options = new Set([
    '--debug',
    '--trace',
    '--version',
    '--new-window',
    '--terminal',
    '--provider',
    ...catalog.map((option) => '--' + option.name),
  ]);
  for (const option of options) {
    yield [option, option];
    yield ['--password J7qxZ8mw ' + option, '--password [redacted] ' + option];
  }
  // An 86-character option can have the shape of a signature when it occupies the whole line.
  const longOption = '--debug'.padEnd(licenseSignature.length, 'g');
  yield [longOption, '[redacted]'];
  yield ['--password J7qxZ8mw ' + longOption, '--password [redacted] ' + longOption];
  yield ['token=viewer-license-1.', 'token=[redacted]'];
}

function* assignments(): Generator<GeneratedCredential> {
  const words = ['J7qxB5nv', 'Z8mwF6yp'];
  const values = [words[0]!, words.join(' '), words.join('='), words.join("'")];
  for (const [open, close] of [
    ['"', '"'],
    ["'", "'"],
    ['\x60', '\x60'],
    ['“', '”'],
    ['‘', '’'],
  ] as const) {
    for (const separator of [' ', '\n']) values.push(open + words.join(separator) + close);
  }
  for (const prefix of ['', '_', '__DB_', 'api-', 'X'.repeat(180) + '_']) {
    for (const ending of ['Password', 'AUTH_TOKEN', 'client-secret']) {
      const name = prefix + ending;
      for (const value of values) {
        const open = value === words.join("'");
        for (const padding of ['', '  ']) {
          yield { message: name + '=' + padding + value, value, open };
          yield { message: 'config ' + name + padding + ':' + padding + value, value, open };
        }
        yield { message: 'env ' + name + '=' + value + ' viewer --version', value, open };
        yield { message: '{"' + name + '":' + JSON.stringify(value) + ',"ok":true}', value };
        yield {
          message: 'https://local.invalid/?' + name + '=' + encodeURIComponent(value) + '&ok=1',
          value: encodeURIComponent(value),
        };
        yield { message: '--' + name + '=' + shellQuote(value) + ' --ok', value };
        yield { message: shellQuote('--' + name) + ' ' + shellQuote(value) + ' --ok', value };
      }
    }
  }
  for (const [message, expected] of recordBoundaries()) {
    if (message.includes('J7qxZ8mw') && message !== expected) yield { message, value: 'J7qxZ8mw' };
  }
  for (const name of ['_ACCESS_KEY', '__PRIVATE_KEY', 'ssh_askpass_require']) {
    for (const literal of [':part', '=part', 'plain']) {
      const value = words.join("'\n");
      yield { message: name + "='part'" + literal + shellQuote(value), value };
    }
    for (const before of ["'", "'s", "\\'", "'\\", "''", '\' " ', '\\']) {
      for (const breakAt of ['\n', '\r\n']) {
        const value = words[0] + before + breakAt + words[1] + '\\';
        yield {
          message: 'exec /usr/bin/env ' + name + '=' + shellQuote(value) + " 'viewer'",
          value,
        };
      }
    }
    yield { message: name + '=first "' + words.join('\n') + '" after', value: words.join('\n') };
    yield { message: name + ': "' + words.join("'\n") + '" trailing', value: words.join("'\n") };
    yield { message: name + '= "' + words.join('\n'), value: words.join('\n'), open: true };
  }
  for (const message of [
    'token=first {"secret":  ["' + words.join(' ') + '"]}',
    'token=first nested_token:"' + words.join('\n') + '"',
    'fragment#anchor?token=' + words.join(' ') + ' still on the line',
    '?token=' + "'" + words[0] + "'" + words[1] + '&mode=1',
    '{"_AUTH_TOKEN":{"job":["' + words.join(' ') + '"]},"ok":true}',
    '{"_AUTH_TOKEN" : "' + words.join('\n') + '"}',
    '{"_AUTH_TOKEN": ["' + words.join('\n') + '"]}',
    '{"_AUTH_TOKEN":[false,true,null,-123456789.123e-9,{"a":"\\u0041","b":"prefix\n' +
      words.join(' ') +
      '"}]}',
    '{"_AUTH_TOKEN":' +
      '['.repeat(270) +
      '"prefix\n' +
      words.join(' ') +
      '"' +
      ']'.repeat(270) +
      '}',
    '{"_AUTH_TOKEN":["' + words[0] + '\\Q\n' + words[1] + '"]}',
    '_auth_token=“' + words.join("'\r\n") + '” trailing text',
    'Authorization: Bearer "' + words.join('\n') + '"',
    'Proxy-Authorization: Basic' + ' '.repeat(40) + words[0],
  ])
    yield { message, value: message.includes(words[1]!) ? words.join(' ') : words[0]! };
  for (const name of [
    'PASSWD',
    'PWD',
    'pass',
    'cookie',
    'AUTHORIZATION',
    'API_KEY',
    'AccessKey',
    'PRIVATE_KEY',
    'askpass_prompt',
    'askpass_answer',
    'askpass_response',
    'askpass_socket',
    'SSH_ASKPASS',
    'SSH_ASKPASS_REQUIRE',
  ])
    yield { message: '_' + name + '=' + words.join(' '), value: words.join(' ') };
  for (const value of values) yield { message: '-u ' + shellQuote(value), value };
  for (const prefix of ['Authorization: Bearer', 'Proxy-Authorization: Basic']) {
    yield { message: prefix + ' ' + words[0], value: words[0]! };
    yield { message: prefix + '  "' + words.join('\r\n') + '"', value: words.join('\r\n') };
    yield { message: prefix + ' "' + words.join('\n') + '"', value: words.join('\n') };
  }
  const body = words.join('');
  for (const prefix of [
    'sk-',
    'pk-',
    'rk-',
    ...Array.from('pousr', (suffix) => 'gh' + suffix + '_'),
    ...Array.from('abprs', (suffix) => 'xox' + suffix + '-'),
    'glpat-',
    'github_pat_',
  ])
    yield { message: prefix + body, value: body };
  for (const value of [
    'AKIAJ7QXB5NVZ8MWF6YP',
    'ASIAZ8MWF6YPJ7QXB5NV',
    'abcedfddaabbccfedbad',
    'J7qxB5nvZ8mwF6yp==',
  ])
    yield { message: value, value };
  yield {
    message: 'viewer-license-1.' + licensePayload + '.' + licenseSignature,
    value: licenseSignature,
  };
  yield {
    message: 'viewer-license-1.\n' + licensePayload + '.\n' + licenseSignature,
    value: licensePayload,
  };
  yield {
    message: 'token=viewer-license-1.' + licensePayload + '.\n' + licenseSignature,
    value: licenseSignature,
  };
  yield {
    message:
      'env PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n' + body + '\n-----END PRIVATE KEY-----"',
    value: body,
  };
  for (const label of ['env "PRIVATE_KEY=', '"--private-key='])
    yield { message: label + '-----BEGIN PRIVATE KEY-----\n' + body + '"', value: body };
  for (const type of ['PRIVATE KEY', 'RSA PRIVATE KEY'])
    yield {
      message: '-----BEGIN ' + type + '-----\n' + body + '\n-----END ' + type + '-----',
      value: body,
    };
}

/** The spelling and line break of every segment vary independently of its neighbors. */
function* segmentWords(prefix = '', depth = 0): Generator<string> {
  const before = ['J7qx', 'H9vc', 'L4bk'][depth]!;
  const after = ['Z8mw', 'K3ft', 'V6jn'][depth]!;
  for (const [open, close] of [
    ['', ''],
    ["'", "'"],
    ['"', '"'],
    ['\x60', '\x60'],
    ['“', '”'],
    ['‘', '’'],
  ]) {
    for (const join of ['', open ? '\n' : '\\ ']) {
      const word = prefix + open + before + join + after + close;
      yield word;
      if (depth < 2) yield* segmentWords(word, depth + 1);
    }
  }
}

function mixedAssignments(word: string): string[] {
  return [
    '_AUTH_TOKEN=' + word,
    'api-token =  ' + word,
    '__DB_PASSWORD:' + word,
    'config _AUTH_TOKEN :  ' + word,
    'env _AUTH_TOKEN=' + word + ' viewer',
    'exec /usr/bin/env API_TOKEN=' + shellQuote(word) + " 'viewer'",
    'exec /usr/bin/env ' + shellQuote('API_TOKEN=' + word) + " 'viewer'",
    '--auth-token=' + word + ' --ok',
    '--auth-token ' + word + ' --ok',
    shellQuote('--auth-token=' + word) + ' --ok',
    "'--auth-token' " + word + ' --ok',
    '-u ' + word,
    'Authorization: Bearer ' + word,
    'Proxy-Authorization: Basic ' + word,
    JSON.stringify({ _AUTH_TOKEN: word, ok: true }),
    '?_AUTH_TOKEN=' + encodeURIComponent(word) + '&ok=1',
  ];
}

/** Check each submitted case against its own persisted records, including the trusted source prefix. */
async function persistedWithRecovery(
  route: Route,
  cases: { message: string; open?: boolean }[],
): Promise<string[]> {
  const statuses = (index: number) => {
    const plain = 'worker ready ' + index;
    const json = JSON.stringify({ state: 'idle', record: index });
    return index % 3 === 0
      ? [json, plain]
      : index % 3 === 1
        ? [String(index), json]
        : [plain, json];
  };
  const rows = await persisted(
    route,
    cases.map(({ message, open }, index) =>
      open ? message : [message, ...statuses(index)].join('\n'),
    ),
  );
  const worker = route === 'worker' || route === 'named-worker';
  const prefix = route === 'named-worker' ? 'Token: ' : '';
  const details: string[] = [];
  const missing: number[] = [];
  let offset = 0;
  for (const [index, { message, open }] of cases.entries()) {
    if (worker) {
      const end = offset + message.split('\n').length;
      details.push(...rows.slice(offset, end));
      offset = end;
      if (open) continue;
      const [plain, structured] = statuses(index);
      if (rows[offset] !== prefix + plain || rows[offset + 1] !== prefix + structured)
        missing.push(index);
      offset += 2;
    } else {
      const row = rows[offset++]!;
      if (open) details.push(row);
      else {
        const suffix = '\n' + statuses(index).join('\n');
        if (!row.endsWith(suffix)) missing.push(index);
        details.push(row.endsWith(suffix) ? row.slice(0, -suffix.length) : row);
      }
    }
  }
  expect(missing.slice(0, 5).map((index) => cases[index]?.message)).toEqual([]);
  expect(offset).toBe(rows.length);
  return details;
}

function addFragments(fragments: Set<string>, value: string): void {
  for (let start = 0; start + 4 <= value.length; start++)
    fragments.add(value.slice(start, start + 4));
}

function containsFragment(fragments: Set<string>, row: string): boolean {
  for (let index = 0; index + 4 <= row.length; index++) {
    if (fragments.has(row.slice(index, index + 4))) return true;
  }
  return false;
}

describe('persisted credential boundaries', () => {
  it.each(routes)('checks generated physical record boundaries via %s', async (route) => {
    const cases = Array.from(recordBoundaries());
    const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
    for (const after of [
      ['worker ready', '{"state":"idle"}'],
      ['{"state":"idle"}', '42'],
      ['42', 'worker ready'],
    ]) {
      const rows = await persisted(
        route,
        cases.map(([line]) => [line, ...after].join('\n')),
      );
      const expected = cases.flatMap(([, masked]) =>
        route === 'direct' || route === 'service'
          ? [prefix + [masked, ...after].join('\n')]
          : [masked, ...after].map((line) => prefix + line),
      );
      expect(rows).toEqual(expected);
    }
  });

  it.each(routes)(
    'bounds unterminated PEM blocks and recognizes only the matching footer via %s',
    async (route) => {
      const header = '  -----BEGIN RSA PRIVATE KEY-----';
      const body = 'J7qxZ8mw';
      const statuses = ['{"state":"idle"}', 'worker ready'];
      const blocks = [
        [header, body, '-----END PRIVATE KEY-----', body, '-----END RSA PRIVATE KEY-----'],
        [header, ...Array<string>(63).fill(body)],
      ];
      for (const block of blocks) {
        const rows = await persisted(route, [[...block, ...statuses].join('\n')]);
        const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
        if (route === 'worker' || route === 'named-worker') {
          expect(rows.slice(-2)).toEqual(statuses.map((line) => prefix + line));
        } else expect(rows[0]).toBe(prefix + '[redacted]\n' + statuses.join('\n'));
        expect(rows.join('\n')).not.toContain(body);
      }
    },
  );

  it.each(routes)(
    'ends records on CR, LF and CRLF and protects spaced license keys via %s',
    async (route) => {
      const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
      const worker = route === 'worker' || route === 'named-worker';
      for (const separator of ['\r', '\n', '\r\n']) {
        const lines = ['API_TOKEN=J7qxZ8mw\\', '{"state":"idle"}', '42'];
        const actual = await persisted(route, [lines.join(separator)]);
        const expected = ['API_TOKEN=[redacted]', ...lines.slice(1)];
        expect(actual).toEqual(
          worker ? expected.map((line) => prefix + line) : [prefix + expected.join(separator)],
        );
      }
      const key =
        'viewer- license-1. ' +
        licensePayload +
        '. ' +
        licenseSignature.slice(0, 12) +
        '\t' +
        licenseSignature.slice(12);
      const rows = await persisted(route, [key + '\nworker ready\n{"ok":true}']);
      expect(rows).toEqual(
        worker
          ? ['[redacted]', 'worker ready', '{"ok":true}'].map((line) => prefix + line)
          : [prefix + '[redacted]\nworker ready\n{"ok":true}'],
      );
    },
  );

  it.each(['', 'Preview'])(
    'publishes each finished %j worker record before another write',
    async (name) => {
      const root = await temporaryRoot('viewer-live-boundaries-');
      const log = new DiagnosticLog(path.join(root, 'rows.jsonl'));
      const writes: Promise<void>[] = [];
      const worker = new WorkerOutput(
        name,
        (row, source) => writes.push(log.record('worker-output', row, undefined, source)),
        new DiagnosticBudget(200),
      );
      const expected: string[] = [];
      for (const [line, masked] of [
        ['start', 'start'],
        ['format viewer-license-1.', 'format viewer-license-1.'],
        ['token=viewer-license-1.', 'token=[redacted]'],
        ['token=viewer-license-1.ey', 'token=[redacted]'],
        ['viewer-license-1.' + licensePayload + '.' + licenseSignature.slice(0, -7), '[redacted]'],
        ['running', 'running'],
        [
          'Help: -----BEGIN PRIVATE KEY----- is missing.',
          'Help: -----BEGIN PRIVATE KEY----- is missing.',
        ],
        ['{"token":', '{"token":'],
        ['42', '42'],
        ['worker ready', 'worker ready'],
      ]) {
        worker.write(line + '\n');
        expected.push((name ? name + ': ' : '') + masked);
        await Promise.all(writes);
        const rows = (await readFile(log.file, 'utf8'))
          .trimEnd()
          .split('\n')
          .map((raw) => JSON.parse(raw).detail);
        expect(rows).toEqual(expected);
      }
      worker.end();
    },
  );

  it.each(routes)(
    'keeps statuses after literal field names in adjoining quoted segments via %s',
    async (route) => {
      const messages: string[] = [];
      for (const [open, close] of [
        ['"', '"'],
        ["'", "'"],
        ['\x60', '\x60'],
        ['“', '”'],
        ['‘', '’'],
      ]) {
        for (const head of ['caption', "'caption'", 'plain' + open + ' first' + close + 'more']) {
          for (const literal of [
            ' note token=',
            ' --password ',
            ' a: Authorization:',
            ' note\nclient_secret=',
          ]) {
            messages.push('env API_TOKEN=' + head + open + literal + close + ' viewer');
          }
        }
      }
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      const statuses = ['worker ready', '{"state":"idle"}'];
      const actual = await persisted(
        route,
        messages.map((m) => [m, ...statuses].join('\n')),
      );
      const expected = messages.flatMap((message) => {
        if (route === 'direct' || route === 'service')
          return [prefix + 'env API_TOKEN=[redacted]\n' + statuses.join('\n')];
        const entries = message.includes('\n')
          ? ['[Worker continuation omitted]', '[Worker continuation omitted]']
          : ['env API_TOKEN=[redacted]'];
        return [...entries, ...statuses].map((line) => prefix + line);
      });
      expect(actual).toEqual(expected);
    },
  );

  it.each(routes)(
    'keeps credential-looking text inside its original value via %s',
    async (route) => {
      const messages = [
        ["env API_TOKEN=caption' -----BEGIN PRIVATE KEY-----' viewer", 'env API_TOKEN=[redacted]'],
        ['env API_TOKEN=caption"token":', 'env API_TOKEN=[redacted]'],
        ['--password "note -----BEGIN PRIVATE KEY-----" --ok', '--password [redacted] --ok'],
        [
          "--password part:token=x --ok couldn't connect",
          "--password [redacted] --ok couldn't connect",
        ],
        [
          "--password -part:token=x --ok couldn't connect",
          "--password [redacted] --ok couldn't connect",
        ],
        ["--password= couldn't connect", "--password= couldn't connect"],
        ['{"token":"-----BEGIN PRIVATE KEY-----","ok":true}', '{"token":[redacted],"ok":true}'],
        ['{"token":"abc"} couldn\'t connect', '{"token":[redacted]} couldn\'t connect'],
        [
          "https://local.invalid/?plan=token=can't&ok=1",
          "https://local.invalid/?plan=token=can't&ok=1",
        ],
        [
          "https://local.invalid/?plan=x&token=token=can't&ok=1",
          'https://local.invalid/?plan=x&token=[redacted]&ok=1',
        ],
      ] as const;
      const last = ['{"state":"idle"}', 'worker ready'];
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      const rows = await persisted(
        route,
        messages.map(([message]) => [message, ...last].join('\n')),
      );
      expect(rows).toEqual(
        messages.flatMap(([, line]) =>
          route === 'direct' || route === 'service'
            ? [prefix + [line, ...last].join('\n')]
            : [line, ...last].map((value) => prefix + value),
        ),
      );
    },
  );

  it.each(routes)(
    'recognizes authorization schemes only in credential fields via %s',
    async (route) => {
      const cases: [string, string][] = [];
      for (const scheme of ['Basic', 'Bearer', 'bAsIc', 'BEARER']) {
        for (const tail of ['', ' ', ' is available']) {
          for (const key of ['plan', 'token']) {
            const url = 'https://example.invalid/?p=1&' + key + '=';
            cases.push([
              url + scheme + tail,
              url + (key === 'token' ? '[redacted]' : scheme) + tail,
            ]);
          }
          for (const text of [scheme + tail, 'plan ' + scheme + tail]) cases.push([text, text]);
        }
        for (const name of ['Authorization', 'Proxy-Authorization']) {
          cases.push([name + ': ' + scheme, name + ': [redacted]']);
          cases.push([name + ': ' + scheme + ' J7qxZ8mw', name + ': [redacted]']);
        }
      }
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      const statuses = ['worker ready', '{"state":"idle"}'];
      const rows = await persisted(
        route,
        cases.map(([text]) => [text, ...statuses].join('\n')),
      );
      const expected = cases.flatMap(([, line]) =>
        route === 'direct' || route === 'service'
          ? [prefix + [line, ...statuses].join('\n')]
          : [line, ...statuses].map((value) => prefix + value),
      );
      expect(rows).toEqual(expected);
    },
  );

  it.each(routes)(
    'preserves statuses after a credential member with a missing value via %s',
    async (route) => {
      const first = '{"Authorization":';
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      for (const status of ['worker ready', 'failed to start', '42 workers ready']) {
        const lines = [first, status, '{"state":"idle"}'];
        const rows = await persisted(route, [lines.join('\n')]);
        expect(rows).toEqual(
          route === 'direct' || route === 'service'
            ? [prefix + lines.join('\n')]
            : lines.map((line) => prefix + line),
        );
      }
    },
  );

  it.each(routes)(
    'protects a quoted environment operand through its last line via %s',
    async (route) => {
      const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
      const statuses = ['worker ready', '{"state":"idle"}'];
      for (const value of [
        'J7qx\nZ8mw',
        '',
        "J7qx's\r\nZ8mw\\",
        'J7qx\nZ8mw\nK3ft',
        'text client_secret=J7qx',
        'Bearer J7qx',
        'note --auth-token J7qx',
        'note "token": J7qx',
      ]) {
        const name = '__API_TOKEN';
        for (const operand of [
          shellQuote(name + '=' + value),
          name + '=' + shellQuote(value),
          '"' + name + '=' + value.replace(/[\\"]/g, '\\$&') + '"',
        ]) {
          const message = ['/usr/bin/env ' + operand + " 'viewer'", ...statuses].join('\n');
          const rows = await persisted(route, [message]);
          expect(rows.join('\n')).not.toMatch(/J7qx|Z8mw|K3ft/);
          if (route === 'worker' || route === 'named-worker')
            expect(rows.slice(-2)).toEqual(statuses.map((line) => prefix + line));
          else expect(rows[0]).toMatch(/\[redacted\]\nworker ready\n\{"state":"idle"\}$/);
        }
      }
    },
  );

  it.each(routes)('ends an empty query parameter before trailing prose via %s', async (route) => {
    const statuses = ['worker ready', '{"state":"idle"}'];
    const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
    const messages: string[] = [];
    for (const query of [
      'https://example.invalid/?token=',
      'https://example.invalid/?p=1&_API_KEY=',
      '?AUTH_TOKEN=',
    ])
      for (const space of [' ', '\t', '   '])
        messages.push([query + space + "couldn't connect", ...statuses].join('\n'));
    const expected =
      route === 'worker' || route === 'named-worker'
        ? messages.flatMap((message) => message.split('\n'))
        : messages;
    expect(await persisted(route, messages)).toEqual(
      expected.map((line) => prefix + line.replace(/\t/g, ' ')),
    );
    const padded = await persisted(route, ["config token=   'J7qx\nZ8mw' tool\nworker ready"]);
    expect(padded.join('\n')).not.toMatch(/J7qx|Z8mw/);
    expect(padded.at(-1)).toMatch(/worker ready$/);
  });

  it.each(['', 'Token'])(
    'writes disqualified license filenames while the %j worker is open',
    async (name) => {
      const root = await temporaryRoot('viewer-live-license-');
      const log = new DiagnosticLog(path.join(root, 'rows.jsonl'));
      const writes: Promise<void>[] = [];
      const worker = new WorkerOutput(
        name,
        (row, source) => writes.push(log.record('worker-output', row, undefined, source)),
        new DiagnosticBudget(100),
      );
      const expected = ['worker started'];
      const prefix = name ? name + ': ' : '';
      worker.write('worker started\n');
      for (const extension of [
        'eyaml',
        Buffer.from('{f').toString('base64url'),
        Buffer.from('{&').toString('base64url'),
        Buffer.from('{ "field" !').toString('base64url'),
        Buffer.from('{"field": false !').toString('base64url'),
        Buffer.from([0x7b, 0x22, 0x61, 0xff]).toString('base64url'),
      ]) {
        const lines = ['loading viewer-license-1.' + extension, 'worker ready', 'retry complete'];
        for (const line of lines) {
          for (const ch of line + '\n') worker.write(ch);
          expected.push(line);
          await Promise.all(writes);
          const rows = (await readFile(log.file, 'utf8'))
            .trimEnd()
            .split('\n')
            .map((raw) => JSON.parse(raw).detail);
          expect(rows).toEqual(expected.map((detail) => prefix + detail));
        }
      }
      const first = 'loading viewer-license-1.ey';
      worker.write(first + '\n');
      await Promise.all(writes);
      const last = (await readFile(log.file, 'utf8')).trimEnd().split('\n').at(-1)!;
      expect(JSON.parse(last).detail).toBe(prefix + 'loading [redacted]');
      worker.write('aml');
      worker.end();
      await Promise.all(writes);
      const closed = (await readFile(log.file, 'utf8')).trimEnd().split('\n');
      expect(closed.map((line) => JSON.parse(line).detail)).toEqual(
        [...expected, 'loading [redacted]', 'aml'].map((detail) => prefix + detail),
      );
    },
  );

  it.each(routes)(
    'follows a structured member at the start of a free-text value via %s',
    async (route) => {
      const messages = ['token= "nested_secret": ["J7qx\nZ8mw"]\nworker ready'];
      const rows = await persisted(route, messages);
      expect(rows.join('\n')).not.toMatch(/J7qx|Z8mw/);
      expect(rows.at(-1)).toMatch(/worker ready$/);
    },
  );

  it.each(routes)(
    'protects every payload wrap of a signed UTF-8 JSON object via %s',
    async (route) => {
      const payload = {
        later: [true, false, null, -12.5, 1e-17, { '\u1234': 'α冬😀\\a"\n\u0001' }],
        email: 'fixture@example.invalid',
        order: 'fixture',
        issued: '2026-11-18',
        product: 'viewer',
      };
      const bytes = Buffer.from(' \n' + JSON.stringify(payload, null, 2) + '\n');
      const encoded = bytes.toString('base64url');
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const signature = sign(null, bytes, privateKey).toString('base64url');
      const marker = 'viewer-license-1.';
      expect(readLicenseKey(marker + encoded + '.' + signature, publicKey).order).toBe(
        payload.order,
      );
      const messages = Array.from(
        { length: encoded.length + 1 },
        (_, cut) =>
          marker +
          encoded.slice(0, cut) +
          '\n' +
          encoded.slice(cut) +
          '.' +
          signature +
          '\nworker ready',
      );
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      const rows = await persisted(route, messages);
      const worker = route === 'worker' || route === 'named-worker';
      const mask = '[redacted]';
      expect(rows).toEqual(
        messages.flatMap((_, cut) => {
          const lines = [cut ? mask : marker, mask, 'worker ready'];
          return worker ? lines.map((line) => prefix + line) : [prefix + lines.join('\n')];
        }),
      );
    },
  );

  it.each(routes)(
    'keeps exact query boundaries and quoted CRLF continuations via %s',
    async (route) => {
      const messages = [
        '_AUTH_TOKEN="plain\\\r\nJ7qxB5nv"\nworker ready',
        '--auth-token="plain\\\r\nJ7qxB5nv" --ok\nworker ready',
        "https://host/?auth-token=can't&ok=1\nworker ready",
        'https://host/?auth-token=part%20two&ok=1\nworker ready',
      ];
      const rows = await persisted(route, messages);
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      expect(rows.join('\n')).not.toContain('J7qx');
      expect(rows.filter((row) => row.endsWith('worker ready'))).toHaveLength(messages.length);
      expect(
        rows.filter((row) => row.includes(prefix + 'https://host/?auth-token=[redacted]&ok=1')),
      ).toHaveLength(2);
    },
  );

  it.each(routes)(
    'keeps an unfinished adjoining quote private through stream end via %s',
    async (route) => {
      const messages = ['"', "'", '\x60', '‘', '“'].map(
        (open) => 'PASSWORD=plain' + open + 'J7qx\nZ8mw\nK3ft',
      );
      const rows = await persisted(route, messages);
      expect(rows.join('\n')).not.toMatch(/J7qx|Z8mw|K3ft/);
      expect(rows).toHaveLength(
        (route === 'worker' || route === 'named-worker' ? 3 : 1) * messages.length,
      );
    },
  );

  it.each(['direct', 'service'] as const)(
    'masks a complete key crossing the display limit via %s',
    async (route) => {
      const key = 'viewer-license-1.' + licensePayload + '.' + licenseSignature;
      const messages = [32, key.length - 1].map((cut) => 'x'.repeat(7999 - cut) + ' ' + key);
      const rows = await persisted(route, messages);
      for (const row of rows) {
        expect(row).toContain('[redacted]');
        expect(row).not.toContain(licensePayload.slice(0, 8));
      }
    },
  );

  it.each(routes)(
    'masks adjoining segments and resumes after each spelling via %s',
    async (route) => {
      const messages: string[] = [];
      const fragments = new Set<string>();
      for (const word of segmentWords()) {
        for (const spelling of [
          word,
          encodeURIComponent(word),
          JSON.stringify(word).slice(1, -1),
          shellQuote(word).slice(1, -1),
        ])
          addFragments(fragments, spelling);
        for (const assignment of mixedAssignments(word)) messages.push(assignment);
      }
      const rows = await persistedWithRecovery(
        route,
        messages.map((message) => ({ message })),
      );
      expect(rows.filter((row) => containsFragment(fragments, row)).slice(0, 5)).toEqual([]);
    },
    120000,
  );

  it.each(routes)(
    'preserves marker paths, filenames, sentences and subsequent records via %s',
    async (route) => {
      const marker = 'viewer-license-1';
      const statuses = ['worker ready', '[warning] retry complete', '{"state":"idle"}'];
      const ordinary: string[] = [];
      for (const ending of ['.', '.d', '.json', '.abc.def', '.a/b', '.a+b', '.a=b']) {
        const name = marker + ending;
        ordinary.push(
          '/schemas/' + name + '/default.json',
          name,
          'Could not open ' + name + ' yesterday.',
        );
      }
      const body = marker + '.' + licensePayload + '.';
      for (const signature of [licenseSignature + 'A', licenseSignature.slice(0, -1) + 'B']) {
        ordinary.push(body + signature);
      }
      for (const separator of ['/', '+', '=']) {
        ordinary.push(
          body + licenseSignature.slice(0, 40) + separator + licenseSignature.slice(41),
        );
      }
      const messages = ordinary.map((line) => [line, ...statuses].join('\n'));
      const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
      const worker = route === 'worker' || route === 'named-worker';
      const expected = worker ? messages.flatMap((message) => message.split('\n')) : messages;
      expect(await persisted(route, messages)).toEqual(expected.map((row) => prefix + row));
      // These independent submissions are each a plausible key fragment at the instant of delivery.
      const partial = [body + licenseSignature.slice(1), body, licenseSignature];
      const mask = '[redacted]';
      expect(await persisted(route, partial)).toEqual(partial.map(() => prefix + mask));
    },
  );

  it.each(routes)(
    'resumes after complete launcher environment assignments via %s',
    async (route) => {
      const values = [
        "reader's\nJ7qxB5nv",
        'reader\\',
        "reader\\'s\r\nJ7qxB5nv\\",
        "reader''\nJ7qxB5nv'",
      ];
      const status = 'worker ready';
      for (const value of values) {
        const message =
          'exec /usr/bin/env _API_TOKEN=' + shellQuote(value) + " 'viewer'\n" + status;
        const rows = await persisted(route, [message]);
        const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
        if (route === 'direct' || route === 'service')
          expect(rows).toEqual([prefix + 'exec /usr/bin/env _API_TOKEN=[redacted]\n' + status]);
        else {
          expect(rows.join('\n')).not.toMatch(/reader|J7qx|B5nv/);
          expect(rows.at(-1)).toBe(prefix + status);
        }
      }
    },
  );

  it.each(routes)('keeps format warnings and their following records via %s', async (route) => {
    const statuses = ['worker ready', '[warning] retry complete', '{"state":"idle"}'];
    for (const version of [
      'viewer-license-10',
      'viewer-license-11.preview',
      'viewer-license-1beta',
      'viewer-license-1',
    ]) {
      const lines = ['unsupported format ' + version, ...statuses];
      const rows = await persisted(route, [lines.join('\n')]);
      const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
      expect(rows).toEqual(
        route === 'direct' || route === 'service'
          ? [prefix + lines.join('\n')]
          : lines.map((line) => prefix + line),
      );
    }
  });

  it.each(routes)('masks a signed key in a path or across a line break via %s', async (route) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const key = issueLicenseKey(
      {
        product: 'viewer',
        email: 'fixture@example.invalid',
        order: 'fixture',
        issued: '2026-11-18',
      },
      privateKey,
      {
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        purchaseURL: 'https://purchase.example.invalid/viewer',
      },
    );
    const prefix = route === 'named-worker' || route === 'service' ? 'Token: ' : '';
    const paths = ['/licenses/' + key + '/details.json', '/licenses/' + key + '/'];
    expect(
      await persistedWithRecovery(
        route,
        paths.map((message) => ({ message })),
      ),
    ).toEqual(paths.map((message) => prefix + message.replace(key, '[redacted]')));
    const statuses = ['worker ready', '[warning] retry complete', '{"state":"idle"}'];
    const markerEnd = key.indexOf('.') + 1;
    for (const split of [4, markerEnd - 1, markerEnd, key.lastIndexOf('.'), key.length - 1]) {
      const context = 'İşlem ';
      const lines = [context + key.slice(0, split), key.slice(split), ...statuses];
      const rows = await persisted(route, [lines.join('\n')]);
      const worker = route === 'worker' || route === 'named-worker';
      const mask = '[redacted]';
      const first = split <= markerEnd ? lines[0]! : context + mask;
      const second = split === key.length - 1 ? key.slice(split) : mask;
      const expected = [first, second, ...statuses];
      expect(rows).toEqual(
        worker ? expected.map((line) => prefix + line) : [prefix + expected.join('\n')],
      );
    }
  });

  it.each(routes)(
    'keeps no four-character fragment of generated credential values via %s',
    async (route) => {
      const cases = Array.from(assignments());
      const details = await persistedWithRecovery(route, cases);
      const rows =
        route === 'worker' || route === 'named-worker'
          ? cases.reduce((count, c) => count + c.message.split('\n').length, 0)
          : cases.length;
      expect(details).toHaveLength(rows);
      const fragments = new Set<string>();
      for (const { value } of cases) addFragments(fragments, value);
      const leaks = details.filter((row) => containsFragment(fragments, row));
      expect(leaks.slice(0, 5)).toEqual([]);
    },
  );

  it('applies the log policy once for console errors and main rejections', async () => {
    const root = await temporaryRoot('viewer-credential-ingress-');
    const log = new DiagnosticLog(path.join(root, 'rows.jsonl'));
    const writes: Promise<void>[] = [];
    const output = { error: (..._values: unknown[]) => {} };
    recordConsoleErrors(
      output,
      (detail, fields) => writes.push(log.record('main-error', detail, fields)),
      new DiagnosticBudget(),
    );
    const failures = new MainFailures({
      record: (detail, fields) => writes.push(log.record('main-rejection', detail, fields)),
      ask: async () => 'quit',
      showLog() {},
      quit() {},
    });
    const message = '{"token":"abc","state":"ready"}';
    output.error(message);
    failures.rejection(message);
    await Promise.all(writes);
    const details = (await readFile(log.file, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line).detail);
    expect(details).toEqual(Array(2).fill('{"token":[redacted],"state":"ready"}'));
  });

  it.each(routes)('keeps complete lines without credentials via %s', async (route) => {
    const ordinary = [
      'parser saw [offset',
      '{"state":"ready"}',
      '{"state":"retrying"}',
      '[warning] saved',
      '  indent preserved  ',
      'finished --mode= two words',
    ];
    for (const name of ['STATUS', '_stage', 'retry_count', 'configured-mode', 'configuration']) {
      for (const value of ['queued', 'two words', '"ready now"', "couldn't read [offset"])
        ordinary.push(name + '=' + value, name + ': ' + value, JSON.stringify({ [name]: value }));
    }
    const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
    expect(await persisted(route, ordinary)).toEqual(ordinary.map((message) => prefix + message));
  });

  it.each(routes)(
    'preserves exact option and JSON boundaries and masks env fields via %s',
    async (route) => {
      const messages = [
        '--db-password= viewer --version',
        'env DB_PASSWORD= viewer --version',
        '{"token":"abc","state":"ready"}',
      ];
      const prefix = route === 'service' || route === 'named-worker' ? 'Token: ' : '';
      expect(await persisted(route, messages)).toEqual(
        [
          '--db-password= viewer --version',
          'env DB_PASSWORD= [redacted]',
          '{"token":[redacted],"state":"ready"}',
        ].map((message) => prefix + message),
      );
    },
  );
});
