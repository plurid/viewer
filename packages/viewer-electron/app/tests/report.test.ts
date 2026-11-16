import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diagnosticReport,
  makeDiagnosticReport,
  reportLimits,
} from '../src/desktop/diagnostics/report';
import type { ReportInput } from '../src/desktop/diagnostics/report';

const local = vi.hoisted(() => ({
  commands: vi.fn(async (file: string, args: string[], _options: unknown) => {
    const values: Record<string, string> = {
      '/usr/bin/id -F': 'Example Person',
      '/usr/sbin/scutil --get ComputerName': "Example's Mac",
      '/usr/sbin/scutil --get LocalHostName': 'Example-Mac',
      '/usr/sbin/sysctl -n hw.model': 'Mac16,1',
      '/usr/sbin/sysctl -n machdep.cpu.brand_string': 'Apple M4',
    };
    return { stdout: values[[file, ...args].join(' ')] ?? '' };
  }),
  log: '',
  offset: 0,
  capacity: 0,
  close: vi.fn(async () => {}),
  readError: undefined as Error | undefined,
  volumes: vi.fn(async () => ['Example Disk']),
}));
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0',
    isPackaged: false,
    getAppPath: () => '/Applications/Viewer.app',
    getPath: () => '/Home/Example/Library/Application Support/Viewer',
    getLocale: () => 'en-GB',
    getLocaleCountryCode: () => 'GB',
  },
  screen: { getAllDisplays: () => [{ scaleFactor: 2 }, { scaleFactor: 1 }] },
}));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(() => {}, { [promisify.custom]: local.commands }) };
});
vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({ username: 'example', homedir: '/Home/Example' }),
    homedir: () => '/Home/Example',
    hostname: () => 'Example-Mac.local',
    totalmem: () => 16 * 1024 ** 3,
  },
}));
vi.mock('node:fs/promises', () => ({
  readdir: (file: string) => {
    expect(file).toBe('/Volumes');
    return local.volumes();
  },
  open: async (_file: string, mode: string) => {
    expect(mode).toBe('r');
    if (local.readError) throw local.readError;
    return {
      stat: async (options: { bigint: boolean }) => {
        expect(options.bigint).toBe(true);
        return { size: BigInt(Buffer.byteLength(local.log)) };
      },
      read: async (buffer: Buffer, _offset: number, length: number, position: number) => {
        local.offset = position;
        local.capacity = length;
        const bytes = Buffer.from(local.log).subarray(position, position + length);
        bytes.copy(buffer);
        return { bytesRead: bytes.length };
      },
      close: local.close,
    };
  },
}));

const entry = (index: number, detail = `Failure ${index}`) =>
  JSON.stringify({
    at: new Date(Date.UTC(2026, 10, 1, 12, index)).toISOString(),
    kind: 'renderer-error',
    detail,
    settings: 'must-not-be-copied',
  });
const fixture = (): ReportInput => ({
  facts: {
    release: { version: '1.0.0', build: 123 },
    edition: 'direct',
    license: 'trial',
    macOS: '15.1',
    model: 'Mac16,1',
    chip: 'Apple M4',
    memory: 16 * 1024 ** 3,
    scales: [2, 1],
    language: 'en-GB',
    region: 'GB',
  },
  privateValues: [{ kind: 'home', value: '/Home/Example' }],
  log: [entry(1), entry(2)].join('\n'),
});

beforeEach(() => {
  local.log = '';
  local.readError = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe('report contents', () => {
  it('includes only the requested facts and the newest twenty validated failures', () => {
    const input = fixture();
    input.log =
      Array.from({ length: 30 }, (_, index) => entry(index)).join('\n') +
      '\n' +
      [
        'partial private JSON',
        JSON.stringify({ at: 'a private date', kind: 'renderer-error', detail: 'ignored one' }),
        JSON.stringify({
          at: '2026-11-01T12:01:00.000Z',
          kind: 'a private kind',
          detail: 'ignored two',
        }),
      ].join('\n');
    const report = diagnosticReport(input);
    expect(report).toContain('- Build: 123\n- Edition: direct\n- License: trial');
    expect(report).toContain('- Memory: 16 GiB\n- Displays: 2 (2×, 1×)');
    expect(report).toContain('- Language: en-GB\n- Region: GB');
    expect(report.match(/^### /gm)).toHaveLength(reportLimits.failures);
    expect(report.indexOf('Failure 29')).toBeLessThan(report.indexOf('Failure 28'));
    expect(report).not.toMatch(/Failure 9\b|partial|ignored|must-not-be-copied|settings/);
  });

  it('redacts before truncating messages and quotes Markdown content as text', () => {
    const input = fixture();
    input.log = entry(
      1,
      'Start ' +
        'A'.repeat(2100) +
        '\n<img src="https://private.invalid/file?secret=value">\n' +
        '/Home/Example/Private/Report.pdf',
    );
    const report = diagnosticReport(input);
    expect(report).not.toMatch(/A{20}|private\.invalid|secret=value|Private\/Report/);
    expect(report).toContain('> Start <token>');
    expect(report).toContain('> ~/…/….pdf');
    expect(diagnosticReport({ ...input, log: entry(1, 'safe '.repeat(1000)) }).length).toBeLessThan(
      2600,
    );
  });

  it('keeps safe facts and omits all failures when a privacy check is unavailable', () => {
    const input = fixture();
    input.privateValues.push({ kind: 'computer name', value: undefined });
    const report = diagnosticReport(input);
    expect(report).toContain('- Model: Mac16,1');
    expect(report).toContain('Could not check: computer name. Failure excerpts omitted.');
    expect(report).not.toContain('Failure 1');
  });

  it('distinguishes no failures from an unreadable diagnostic log', () => {
    expect(diagnosticReport({ ...fixture(), log: '' })).toContain('No failures recorded.');
    expect(diagnosticReport({ ...fixture(), log: undefined })).toContain('could not be read');
  });
});

describe('local report collection', () => {
  it('reads a bounded tail and uses only fixed local metadata commands', async () => {
    local.log =
      'x'.repeat(reportLimits.bytes) +
      '\n' +
      entry(1, 'Failed /Home/Example/Private/Report.pdf') +
      '\n';
    const report = await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', {
      kind: 'licensed',
      email: 'never-copy@buyer.invalid',
    });
    expect(local.capacity).toBe(reportLimits.bytes);
    expect(local.offset).toBeGreaterThan(0);
    expect(local.close).toHaveBeenCalledOnce();
    expect(report).toContain('- License: licensed');
    expect(report).toContain('~/…/….pdf');
    expect(report).not.toMatch(/never-copy|buyer\.invalid|Example|Private\/Report/);
    expect(local.commands.mock.calls.map(([file, args]) => [file, ...args].join(' '))).toEqual([
      '/usr/bin/id -F',
      '/usr/sbin/scutil --get ComputerName',
      '/usr/sbin/scutil --get LocalHostName',
      '/usr/sbin/sysctl -n hw.model',
      '/usr/sbin/sysctl -n machdep.cpu.brand_string',
    ]);
    for (const [, , options] of local.commands.mock.calls)
      expect(options).toEqual({ timeout: 2000, maxBuffer: 4096 });
  });

  it('never exposes failed identity lookups or their error messages', async () => {
    local.log = entry(1, 'This might contain an unknown host');
    local.commands.mockRejectedValueOnce(new Error('private lookup details'));
    const report = await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', {
      kind: 'trial',
      daysLeft: 5,
    });
    expect(report).toContain('Could not check: full name. Failure excerpts omitted.');
    expect(report).not.toMatch(/unknown host|private lookup details|daysLeft/);
  });

  it('fails closed when volumes cannot be checked', async () => {
    local.volumes.mockRejectedValueOnce(new Error('private mount names'));
    expect(await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', undefined)).toContain(
      'volume name. Failure excerpts omitted.',
    );
  });

  it('uses the same report for the Store edition, with licensed as the status word', async () => {
    const previous = Object.getOwnPropertyDescriptor(process, 'mas');
    Object.defineProperty(process, 'mas', { configurable: true, value: true });
    try {
      const report = await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', undefined);
      expect(report).toContain('- Edition: Mac App Store\n- License: licensed');
      expect(report).toContain('No failures recorded.');
    } finally {
      if (previous) Object.defineProperty(process, 'mas', previous);
      else Reflect.deleteProperty(process, 'mas');
    }
  });

  it.each(['ENOENT', 'EACCES'])('handles a missing or unreadable log (%s)', async (code) => {
    local.readError = Object.assign(new Error('sensitive path'), { code });
    const report = await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', undefined);
    expect(report).toContain(code === 'ENOENT' ? 'No failures recorded.' : 'could not be read');
    expect(report).not.toContain('sensitive path');
  });
});
