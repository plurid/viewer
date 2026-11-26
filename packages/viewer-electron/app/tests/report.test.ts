import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diagnosticReport,
  makeDiagnosticReport,
  makeDiagnosticReportSnapshot,
  reportLimits,
} from '../src/desktop/diagnostics/report';
import type { ReportInput } from '../src/desktop/diagnostics/report';
import { DiagnosticBudget, WorkerOutput } from '../src/desktop/diagnostics/failures';

const local = vi.hoisted(() => ({
  commands: vi.fn(async (file: string, args: string[], _options: unknown) => {
    const values: Record<string, string> = {
      '/usr/bin/id -F': 'Example Person',
      '/usr/sbin/scutil --get ComputerName': "Example's Mac",
      '/usr/sbin/scutil --get LocalHostName': 'Example-Mac',
      '/usr/sbin/sysctl -n hw.model': 'Mac16,1',
      '/usr/sbin/sysctl -n machdep.cpu.brand_string': 'Apple M4',
    };
    if ([file, ...args].join(' ') === local.failCommand) throw new Error('private lookup details');
    return { stdout: values[[file, ...args].join(' ')] ?? '' };
  }),
  log: '',
  failCommand: '',
  actualHome: '/Home/Example',
  realpath: vi.fn(async (_file: string) => local.actualHome),
  offset: 0,
  capacity: 0,
  close: vi.fn(async () => {}),
  readError: undefined as Error | undefined,
  volumes: vi.fn(async () => ['Example Disk']),
}));
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-0',
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
    constants: { errno: { ENOENT: 2, EACCES: 13 } },
    userInfo: () => ({ username: 'example', homedir: '/Home/Example' }),
    homedir: () => '/Home/Example',
    hostname: () => 'Example-Mac.local',
    totalmem: () => 16 * 1024 ** 3,
  },
}));
vi.mock('node:fs/promises', () => ({
  realpath: local.realpath,
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

const entry = (index: number, detail = `Failure ${index}`, code?: string) =>
  JSON.stringify({
    at: new Date(Date.UTC(2026, 10, 1, 12, index)).toISOString(),
    kind: 'renderer-error',
    detail,
    code,
    settings: 'must-not-be-copied',
  });
const fixture = (): ReportInput => ({
  facts: {
    release: { version: '0.1.0-0', build: 123 },
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
  local.failCommand = '';
  local.actualHome = '/Home/Example';
  local.readError = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe('report contents', () => {
  it('keeps worker failure records without copying fragments of stderr filenames', () => {
    const records: string[] = [];
    const worker = new WorkerOutput(
      'Preview',
      (detail) => {
        records.push(
          JSON.stringify({
            at: '2026-11-01T12:01:00.000Z',
            kind: 'worker-output',
            detail,
          }),
        );
      },
      new DiagnosticBudget(),
    );
    worker.write("ENOENT: open '/Home/Example/Private\n    at Sample");
    worker.write(" Folder'\n");
    expect(records).toHaveLength(2);
    const report = diagnosticReport({
      ...fixture(),
      includeMessageText: true,
      log: records.join('\n'),
    });
    expect(report.match(/\(worker-output\)/g)).toHaveLength(2);
    expect(report).not.toMatch(/Sample|Folder|Preview|Private/);
  });
  it('includes only requested facts and the newest twenty validated failures', () => {
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
    expect(report.indexOf('12:29:00')).toBeLessThan(report.indexOf('12:28:00'));
    expect(report).not.toMatch(/12:09:00|Failure|partial|ignored|must-not-be-copied|settings/);
  });

  it('puts the last recorded failure first when timestamps are equal', () => {
    const report = diagnosticReport({
      ...fixture(),
      log: [entry(1, 'earlier', 'ENOENT'), entry(1, 'latest', 'EACCES')].join('\n'),
    });
    expect(report.indexOf('EACCES')).toBeLessThan(report.indexOf('ENOENT'));
    expect(report).not.toMatch(/earlier|latest/);
  });

  it('includes bounded, well-formed excerpts only after opt-in', () => {
    const input = fixture();
    input.includeMessageText = true;
    const prefix = 'Start ' + 'A'.repeat(2100);
    input.log = entry(1, prefix + '\n/Home/Example/Private/Report.pdf');
    const report = diagnosticReport(input);
    expect(report).not.toMatch(/A{20}|Private|Report\.pdf/);
    expect(report.match(/^> .*$/gm)).toEqual(['> ~/…/….pdf']);
    const isolated = diagnosticReport({ ...input, log: entry(1, prefix) });
    expect(isolated.match(/^> .*$/gm)).toEqual(['> Start [redacted]']);
    expect(() => encodeURIComponent(report)).not.toThrow();
    const long = diagnosticReport({ ...input, log: entry(1, 'safe '.repeat(399) + '😀') });
    expect(() => encodeURIComponent(long)).not.toThrow();
  });

  it('keeps structured failures when opt-in privacy checks fail', () => {
    const input = fixture();
    input.includeMessageText = true;
    input.privateValues.push({ kind: 'computer name', value: undefined });
    const report = diagnosticReport(input);
    expect(report).toContain('Message text omitted: could not check computer name.');
    expect(report.match(/^### /gm)).toHaveLength(2);
    expect(report).not.toContain('Failure 1');
  });

  it('omits path text beyond an ambiguous quote or a frame-shaped newline', () => {
    const input = fixture();
    input.includeMessageText = true;
    input.log = entry(
      1,
      "ENOENT: open '/Home/Example/2026's Private Folder/Notice\n    at Confidential File.pdf'",
      'ENOENT',
    );
    const report = diagnosticReport(input);
    expect(report).toContain('- Code: ENOENT');
    expect(report).toContain('> ENOENT: open ~/…/….pdf');
    expect(report).not.toMatch(/Private|Notice|Confidential|2026's/);
  });

  it('makes each hardware line optional', () => {
    const input = fixture();
    input.facts.model = undefined;
    input.facts.chip = undefined;
    input.facts.memory = undefined;
    const report = diagnosticReport(input);
    expect(report).not.toMatch(/- Model:|- Chip:|- Memory:/);
  });

  it('distinguishes no failures from an unreadable log', () => {
    expect(diagnosticReport({ ...fixture(), log: '' })).toContain('No failures recorded.');
    expect(diagnosticReport({ ...fixture(), log: undefined })).toContain('could not be read');
  });
});

describe('local report collection', () => {
  it('builds both views from one snapshot even if the log changes before opt-in', async () => {
    local.log = entry(1, 'First snapshot failure', 'ENOENT');
    const snapshot = await makeDiagnosticReportSnapshot(
      '/Private/Viewer/Logs/diagnostics.log',
      undefined,
    );
    local.log = entry(2, 'Later failure must not appear', 'EACCES');
    expect(snapshot.report).toContain('12:01:00');
    expect(snapshot.report).not.toContain('12:02:00');
    const messages = await snapshot.withMessageText();
    expect(messages).toContain('12:01:00');
    expect(messages).toContain('First snapshot failure');
    expect(messages).not.toMatch(/12:02:00|Later failure|EACCES/);
    expect(local.close).toHaveBeenCalledOnce();
    expect(await snapshot.withMessageText()).toBe(messages);
    expect(local.volumes).toHaveBeenCalledOnce();
  });

  it('bounds the tail and makes no user, host or volume lookup for the default', async () => {
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
    expect(report).not.toMatch(/never-copy|buyer\.invalid|Example|Private|Report\.pdf/);
    expect(local.commands.mock.calls.map(([file, args]) => [file, ...args].join(' '))).toEqual([
      '/usr/sbin/sysctl -n hw.model',
      '/usr/sbin/sysctl -n machdep.cpu.brand_string',
    ]);
    expect(local.volumes).not.toHaveBeenCalled();
    expect(local.realpath).not.toHaveBeenCalled();
    for (const [, , options] of local.commands.mock.calls)
      expect(options).toEqual({ timeout: 2000, maxBuffer: 4096 });
  });

  it('looks up identities only for explicitly requested messages and fails closed', async () => {
    local.log = entry(1, 'Might contain an unknown host');
    local.failCommand = '/usr/sbin/scutil --get ComputerName';
    const report = await makeDiagnosticReport(
      '/Private/Viewer/Logs/diagnostics.log',
      undefined,
      true,
    );
    expect(report).toContain('Message text omitted: could not check computer name.');
    expect(report).not.toMatch(/unknown host|private lookup details/);
  });

  it('checks the real path of the home only in the optional path', async () => {
    local.actualHome = '/Volumes/PrivateHomes/Example';
    local.log = entry(1, 'open /Volumes/PrivateHomes/Example/Private/Report.pdf');
    const report = await makeDiagnosticReport(
      '/Private/Viewer/Logs/diagnostics.log',
      undefined,
      true,
    );
    expect(report).toContain('~/…/….pdf');
    expect(report).not.toMatch(/Private|Report\.pdf/);
    expect(local.volumes).toHaveBeenCalledOnce();
    expect(local.realpath).toHaveBeenCalledExactlyOnceWith('/Home/Example');
  });

  it('does not let unavailable volume checks suppress the default report', async () => {
    local.volumes.mockRejectedValueOnce(new Error('private mount names'));
    const report = await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', undefined);
    expect(report).toContain('No failures recorded.');
    expect(local.volumes).not.toHaveBeenCalled();
    // Consume the injected failure only on the optional path.
    expect(
      await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', undefined, true),
    ).toContain('could not check volume name');
  });

  it('keeps the same default report in the Store edition without identity lookups', async () => {
    const previous = Object.getOwnPropertyDescriptor(process, 'mas');
    Object.defineProperty(process, 'mas', { configurable: true, value: true });
    try {
      const report = await makeDiagnosticReport('/Private/Viewer/Logs/diagnostics.log', undefined);
      expect(report).toContain('- Edition: Mac App Store\n- License: licensed');
      expect(report).toContain('No failures recorded.');
      expect(local.volumes).not.toHaveBeenCalled();
      expect(local.commands.mock.calls.every(([file]) => file === '/usr/sbin/sysctl')).toBe(true);
    } finally {
      if (previous) Object.defineProperty(process, 'mas', previous);
      else Reflect.deleteProperty(process, 'mas');
    }
  });

  it('names refused Store privacy checks and keeps the safe snapshot without excerpts', async () => {
    const previous = Object.getOwnPropertyDescriptor(process, 'mas');
    Object.defineProperty(process, 'mas', { configurable: true, value: true });
    try {
      local.log = entry(1, 'Private patient text', 'ENOENT');
      const snapshot = await makeDiagnosticReportSnapshot(
        '/Private/Viewer/Logs/diagnostics.log',
        undefined,
      );
      local.failCommand = '/usr/bin/id -F';
      const messages = await snapshot.withMessageText();
      expect(messages).toContain('Message text omitted: could not check full name.');
      expect(messages).toContain('- Edition: Mac App Store\n- License: licensed');
      expect(messages).toContain('- Code: ENOENT');
      expect(messages).not.toContain('Private patient text');
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
