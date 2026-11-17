import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalWorkerRequest } from '../src/desktop/terminals/terminal-protocol';

const fake = vi.hoisted(() => ({
  receive: undefined as ((event: { data: unknown }) => void) | undefined,
  postMessage: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('../src/desktop/workers/worker-port', () => ({
  workerPort: {
    postMessage: fake.postMessage,
    on: (_type: string, receive: typeof fake.receive) => {
      fake.receive = receive;
    },
  },
}));
vi.mock('node-pty', () => ({ spawn: fake.spawn }));
import '../src/desktop/terminals/terminal-worker';

const processes: ReturnType<typeof processStub>[] = [];
let nextID = 0;

function processStub() {
  let data: ((value: string) => void) | undefined;
  let exit: ((event: { exitCode: number }) => void) | undefined;
  return {
    pid: 9900000 + nextID,
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    onData: (callback: typeof data) => {
      data = callback;
    },
    onExit: (callback: typeof exit) => {
      exit = callback;
    },
    data: (value: string) => data?.(value),
    exit: () => exit?.({ exitCode: 0 }),
  };
}

function send(request: TerminalWorkerRequest): void {
  fake.receive?.({ data: request });
}

function start(
  initialInput?: string,
  extra: { readOnly?: boolean; input?: boolean; executable?: string } = {},
) {
  const id = `initial-worker-${++nextID}`;
  send({
    kind: 'start',
    id,
    workspaceID: 'workspace',
    rootID: 'folder',
    cwd: '/fixture',
    profileID: 'login',
    executable: '/bin/sh',
    args: ['-l'],
    env: {},
    cols: 80,
    rows: 24,
    initialInput,
    ...extra,
  });
  return { id, process: processes.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.spawn.mockReset().mockImplementation(() => {
    const process = processStub();
    processes.push(process);
    return process;
  });
});
afterEach(() => {
  for (const process of processes.splice(0)) process.exit();
  vi.useRealTimers();
});

const reports = [
  ['\x1b[6n', '\x1b[24;1R'],
  ['\x1b[?6n', '\x1b[?24;1R'],
  ['\x1b[c', '\x1b[?1;2c'],
  ['\x1b[>c', '\x1b[>0;276;0c'],
  ['\x1b[?2004$p', '\x1b[?2004;2$y'],
  ['\x1b[5n', '\x1b[0n'],
  ['\x1b[18t', '\x1b[8;24;80t'],
  ['\x1b]4;3;?\x07', '\x1b]4;3;rgb:ffff/0000/aaaa\x07'],
  ['\x1b]10;?\x07', '\x1b]10;rgb:ffff/ffff/ffff\x07'],
  ['\x1b]11;?\x1b\\', '\x1b]11;rgb:0000/0000/0000\x1b\\'],
  ['\x1b]12;?\x1b\\', '\x1b]12;rgb:abcd/1234/5678\x1b\\'],
] as const;

const dcsReports = [
  '\x1bP1$r0m\x1b\\',
  '\x1bP0$r\x1b\\',
  '\x1bP1$r; echo INJECTED_BY_DCS; : m\x1b\\',
  '\x1bP0$r; echo INJECTED_BY_DCS\x1b\\',
] as const;

describe('private initial shell input', () => {
  it.each([
    '\x1b]0;\recho AHEAD_OF_COMMAND\r\x07',
    '\x1b]echo INSTEAD_OF_COMMAND; #\x1b\\',
    '\x1b]echo INSTEAD_OF_COMMAND; #\x07',
    '\x1bP\recho DCS_AHEAD\r\x1b\\',
    '\x1b]x\necho LF_AHEAD\n\x1b\\',
    '\x1b[200~',
    '\x1bb',
    '\x1b[A',
  ])('holds unrequested escape input until after the approved command: %j', (data) => {
    const { id, process } = start('npm run dev');
    send({ kind: 'write', id, data });
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(process.write.mock.calls).toEqual([['npm run dev\r'], [data]]);
  });

  it.each(reports)('passes only one reply for an outstanding query: %j', (query, report) => {
    const { id, process } = start('npm run dev');
    process.data(query);
    send({ kind: 'write', id, data: report });
    expect(process.write.mock.calls).toEqual([[report]]);
    send({ kind: 'write', id, data: report });
    expect(process.write.mock.calls).toEqual([[report]]);
    vi.advanceTimersByTime(3000);
    expect(process.write.mock.calls).toEqual([[report], ['npm run dev\r']]);
  });

  it.each([...reports.map(([, reply]) => reply), ...dcsReports, '\x1b[1;2R', '\x1b[1;5R'])(
    'drops an unsolicited reply shape without replaying it before a held Return: %j',
    (report) => {
      const { id, process } = start('npm run dev');
      send({ kind: 'write', id, data: 'before' + report + 'after\r' });
      expect(process.write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(process.write.mock.calls).toEqual([['npm run dev\r'], ['before'], ['after\r']]);
    },
  );

  it.each(dcsReports)('never passes or replays a DCS reply even with a query: %j', (reply) => {
    const { id, process } = start('npm run dev');
    process.data('\x1bP$qm\x1b\\');
    send({ kind: 'write', id, data: reply });
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(process.write.mock.calls.flat()).not.toContain(reply);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it.each(['resumed', '\r', '\n', '\x00', '\x1b[31m'])(
    'ordinary output cannot clear DECRQSS: %j',
    (output) => {
      const { process } = start('npm run dev');
      process.data('\x1bP$qm\x1b\\' + output);
      process.data('background output while the rc is still reading');
      vi.advanceTimersByTime(200);
      expect(process.write).not.toHaveBeenCalled();
      process.data('\x1b[?2004h');
      vi.advanceTimersByTime(120);
      expect(process.write.mock.calls).toEqual([['npm run dev\r']]);
    },
  );

  it('requires bracketed paste ON after the latest split DECRQSS query', () => {
    const { process } = start('npm run dev');
    process.data('\x1b[?2004h\x1bP$');
    process.data('qm\x1b\\resumed');
    vi.advanceTimersByTime(200);
    expect(process.write).not.toHaveBeenCalled();
    process.data('\x1b[?2004h');
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([['npm run dev\r']]);
  });

  it.each(dcsReports)('dropped DCS cannot clear a query: %j', (reply) => {
    const { id, process } = start('npm run dev');
    process.data('\x1bP$qm\x1b\\');
    send({ kind: 'write', id, data: reply });
    vi.advanceTimersByTime(200);
    expect(process.write).not.toHaveBeenCalled();
    process.data('\x1b[?2004h');
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([['npm run dev\r']]);
  });

  it.each(['/bin/zsh', '/usr/bin/fish'])('requires the latest paste state for %s', (executable) => {
    const { process } = start('npm run dev', { executable });
    process.data('Startup question? ');
    vi.advanceTimersByTime(200);
    expect(process.write).not.toHaveBeenCalled();
    process.data('\x1b[?2004h\x1b[?2004l');
    vi.advanceTimersByTime(200);
    expect(process.write).not.toHaveBeenCalled();
    process.data('\x1b[?2004h');
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([[(executable.endsWith('/zsh') ? '\x1bi' : '') + '\x15npm run dev\r']]);
  });

  it('cancels zsh with paste mode disabled and displays the literal command for manual input', () => {
    const { process } = start('npm run dev', { executable: '/bin/zsh' });
    process.data('prompt');
    vi.advanceTimersByTime(3000);
    expect(process.write).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'data',
        data: expect.stringContaining(
          'Type this command manually when the shell is ready: npm run dev',
        ),
      }),
    );
  });

  it('focus is a continuing mode and never blocks a command', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b[?1004h');
    send({ kind: 'write', id, data: '\x1b[I\x1b[O' });
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([['\x1b[I'], ['\x1b[O'], ['npm run dev\r']]);
  });

  it('cancels DECRQSS at the deadline when only a dropped DCS reply follows', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1bP$qm\x1b\\');
    send({ kind: 'write', id, data: 'ordinary\x1bP1$r0m\x1b\\\r' });
    vi.advanceTimersByTime(2999);
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(process.write.mock.calls).toEqual([['ordinary'], ['\r']]);
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'data',
        data: expect.stringContaining('waiting for an answer'),
      }),
    );
  });

  it.each(reports)('further output never clears another supported query: %j', (query, reply) => {
    const { id, process } = start('npm run dev');
    process.data(query + 'more output');
    process.data('\x1bP$qm\x1b\\resumed\x1b[?2004h');
    vi.advanceTimersByTime(200);
    expect(process.write).not.toHaveBeenCalled();
    send({ kind: 'write', id, data: reply });
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([[reply], ['npm run dev\r']]);
  });

  it('waits for a late CPR reply and then for quiet before typing the command', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b[6n');
    vi.advanceTimersByTime(200);
    expect(process.write).not.toHaveBeenCalled();
    send({ kind: 'write', id, data: '\x1b[5;1R' });
    expect(process.write.mock.calls).toEqual([['\x1b[5;1R']]);
    vi.advanceTimersByTime(119);
    expect(process.write.mock.calls).toEqual([['\x1b[5;1R']]);
    vi.advanceTimersByTime(1);
    expect(process.write.mock.calls).toEqual([['\x1b[5;1R'], ['npm run dev\r']]);
  });

  it('cancels at the deadline with an unanswered query and delivers only ordinary held input', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b[6n');
    send({ kind: 'write', id, data: 'ordinary\x1b[A\x1bP1$r0m\x1b\\\r' });
    vi.advanceTimersByTime(2999);
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(process.write.mock.calls).toEqual([['ordinary'], ['\x1b[A'], ['\r']]);
    expect(process.kill).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'data',
        data: expect.stringMatching(/Viewer did not type.*npm run dev.*waiting for an answer/),
      }),
    );
    send({ kind: 'write', id, data: 'still available' });
    expect(process.write.mock.lastCall).toEqual(['still available']);
  });

  it.each([{ writes: ['\x1b', '\x1b[5;1R'] }, { writes: ['\x1b\x1b[5;1R'] }])(
    'preserves a lone Escape before a matching reply: %j',
    ({ writes }) => {
      const { id, process } = start('npm run dev');
      process.data('\x1b[6n');
      for (const data of writes) send({ kind: 'write', id, data });
      expect(process.write.mock.calls).toEqual([['\x1b[5;1R']]);
      vi.advanceTimersByTime(120);
      expect(process.write.mock.calls).toEqual([['\x1b[5;1R'], ['npm run dev\r'], ['\x1b']]);
    },
  );

  it('waits for both outstanding queries, passes two answers and drops a third', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b[6n\x1b[6n');
    send({ kind: 'write', id, data: '\x1b[1;1R' });
    vi.advanceTimersByTime(200);
    expect(process.write.mock.calls).toEqual([['\x1b[1;1R']]);
    send({ kind: 'write', id, data: '\x1b[2;1R\x1b[3;1R' });
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([['\x1b[1;1R'], ['\x1b[2;1R'], ['npm run dev\r']]);
  });

  it.each(reports)(
    'recognizes queries and replies split at every boundary: %j',
    (query, report) => {
      for (let split = 1; split < Math.max(query.length, report.length); split++) {
        const { id, process } = start('npm run dev');
        process.data(query.slice(0, split));
        process.data(query.slice(split));
        send({ kind: 'write', id, data: report.slice(0, split) });
        send({ kind: 'write', id, data: report.slice(split) });
        expect(process.write.mock.calls).toEqual([[report]]);
      }
    },
  );

  it.each([
    ['\x1b[6n', '\x1b[?1;2R', false, false],
    ['\x1b[?6n', '\x1b[1;2R', false, false],
    ['\x1b[c', '\x1b[>0;1;0c', false, false],
    ['\x1b[?2004$p', '\x1b[?25;2$y', false, false],
    ['\x1b]10;?\x07', '\x1b]11;rgb:ffff/ffff/ffff\x07', false, false],
    ['\x1b]4;3;?\x07', '\x1b]4;4;rgb:ffff/ffff/ffff\x07', false, false],
    ['\x1b]10;?\x07', '\x1b]10;rgb:ffff/ffff/ffff\recho AHEAD\r\x07', true, false],
    ['\x1b]10;?\x07', '\x1b]10;RGB:ffff/ffff/ffff\x07', true, false],
    ['\x1b[?1004h\x1b[?1004l', '\x1b[I', false, true],
  ] as const)(
    'drops mismatched replies and holds input without a reply shape: %j',
    (query, report, held, runs) => {
      const { id, process } = start('npm run dev');
      process.data(query);
      send({ kind: 'write', id, data: report });
      expect(process.write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(process.write.mock.calls).toEqual([
        ...(runs ? [['npm run dev\r']] : []),
        ...(held ? [[report]] : []),
      ]);
    },
  );

  it('does not see a query hidden inside an output string, even when the string exceeds its scan bound', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b]title;' + 'x'.repeat(5000) + '\x1b');
    process.data('[6n\x07');
    send({ kind: 'write', id, data: '\x1b[24;1R' });
    expect(process.write).not.toHaveBeenCalled();
  });

  it('passes split terminal reports through and preserves typed escape keys after the command', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b[6n');
    send({ kind: 'write', id, data: 'typed\x1b[' });
    send({ kind: 'write', id, data: '5;1R\x1b[A\x1b' });
    expect(process.write.mock.calls).toEqual([['\x1b[5;1R']]);
    vi.advanceTimersByTime(3000);
    expect(process.write.mock.calls).toEqual([
      ['\x1b[5;1R'],
      ['npm run dev\r'],
      ['typed'],
      ['\x1b[A'],
      ['\x1b'],
    ]);
  });

  it('cancels the command on overflow and sends all held input to the living shell', () => {
    const { id, process } = start('npm run dev');
    const text = 'x'.repeat(64 * 1024);
    send({ kind: 'write', id, data: text });
    send({ kind: 'write', id, data: 'more\x1b[Arest' });
    send({ kind: 'write', id, data: 'still available' });
    vi.advanceTimersByTime(5000);
    expect(process.write.mock.calls).toEqual([[text], ['more\x1b[Arest'], ['still available']]);
    expect(process.kill).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'data',
        data: expect.stringContaining('pending command was cancelled'),
      }),
    );
  });

  it('permits exactly 64 KiB of held text and does not count completed reports against it', () => {
    const { id, process } = start('npm run dev');
    const text = 'x'.repeat(64 * 1024);
    process.data('\x1b[6n');
    send({ kind: 'write', id, data: text });
    send({ kind: 'write', id, data: '\x1b[5;1R' });
    vi.advanceTimersByTime(3000);
    expect(process.write.mock.calls).toEqual([['\x1b[5;1R'], ['npm run dev\r'], [text]]);
  });

  it('bounds incomplete sequences and counts UTF-16 characters like the renderer', () => {
    const first = start('npm run dev');
    const oversized = '\x1b]' + 'x'.repeat(64 * 1024);
    send({ kind: 'write', id: first.id, data: oversized });
    const second = start('npm run dev');
    const text = 'é'.repeat(32768);
    send({ kind: 'write', id: second.id, data: text });
    send({ kind: 'write', id: second.id, data: 'x' });
    vi.advanceTimersByTime(5000);
    expect(first.process.write.mock.calls).toEqual([[oversized]]);
    expect(second.process.write.mock.calls).toEqual([['npm run dev\r'], [text], ['x']]);
    expect(first.process.kill).not.toHaveBeenCalled();
    expect(second.process.kill).not.toHaveBeenCalled();
  });

  it('lets terminal reports through before the command while holding mixed human text', () => {
    const { id, process } = start('npm run dev');
    process.data('\x1b[6n');
    send({ kind: 'write', id, data: 'before\x1b[24;1Rafter' });
    expect(process.write.mock.calls).toEqual([['\x1b[24;1R']]);
    vi.advanceTimersByTime(120);
    expect(process.write.mock.calls).toEqual([
      ['\x1b[24;1R'],
      ['npm run dev\r'],
      ['before'],
      ['after'],
    ]);
  });

  it('drops the pending command and typeahead when Control-C arrives', () => {
    const { id, process } = start('npm run dev');
    send({ kind: 'write', id, data: 'queued' });
    send({ kind: 'write', id, data: '\x03' });
    process.data('$ ');
    vi.advanceTimersByTime(5000);
    expect(process.write.mock.calls).toEqual([['\x03']]);
  });

  it('waits for the first output and 120 ms of quiet, then writes exactly once', () => {
    const { id, process } = start('npm run dev');
    vi.advanceTimersByTime(500);
    expect(process.write).not.toHaveBeenCalled();
    process.data('Welcome');
    vi.advanceTimersByTime(119);
    process.data('$ ');
    vi.advanceTimersByTime(119);
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(process.write.mock.calls).toEqual([['npm run dev\r']]);
    process.data('server ready');
    send({ kind: 'start', id, cwd: '/fixture' } as TerminalWorkerRequest);
    vi.advanceTimersByTime(5000);
    expect(process.write).toHaveBeenCalledOnce();
    expect(fake.spawn).toHaveBeenCalledOnce();
  });

  it('holds each human write and sends them in order after the command', () => {
    const { id, process } = start('npm run dev');
    send({ kind: 'write', id, data: 'a' });
    send({ kind: 'write', id, data: '\t' });
    process.data('$ ');
    send({ kind: 'write', id, data: 'b\r' });
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    send({ kind: 'write', id, data: 'after' });
    expect(process.write.mock.calls).toEqual([
      ['npm run dev\r'],
      ['a'],
      ['\t'],
      ['b\r'],
      ['after'],
    ]);
  });

  it.each(['silent', 'busy'])('writes by three seconds when the shell is %s', (mode) => {
    const { process } = start('make serve');
    for (let index = 0; index < 29; index++) {
      vi.advanceTimersByTime(100);
      if (mode === 'busy') process.data('starting...');
    }
    vi.advanceTimersByTime(99);
    expect(process.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(process.write.mock.calls).toEqual([['make serve\r']]);
    vi.advanceTimersByTime(1000);
    expect(process.write).toHaveBeenCalledOnce();
  });

  it.each(['exit', 'close', 'kill'] as const)('discards pending input on %s', (kind) => {
    const { id, process } = start('npm run dev');
    send({ kind: 'write', id, data: 'queued' });
    process.data('$ ');
    if (kind === 'exit') process.exit();
    else send({ kind, id });
    vi.advanceTimersByTime(5000);
    expect(process.write).not.toHaveBeenCalled();
  });

  it('cancels queued input when another worker request fails', () => {
    const { id, process } = start('npm run dev');
    process.resize.mockImplementation(() => {
      throw new Error('PTY closed');
    });
    send({ kind: 'resize', id, cols: 100, rows: 30 });
    vi.advanceTimersByTime(5000);
    expect(process.write).not.toHaveBeenCalled();
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it('reports an initial write failure and never flushes the queued keystrokes', () => {
    const { id, process } = start('npm run dev');
    process.write.mockImplementation(() => {
      throw new Error('PTY closed');
    });
    send({ kind: 'write', id, data: 'queued' });
    process.data('$ ');
    vi.advanceTimersByTime(5000);
    expect(process.write.mock.calls).toEqual([['npm run dev\r']]);
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'error', id, message: 'PTY closed' });
  });

  it('preserves ordinary terminals immediate input', () => {
    const { id, process } = start();
    send({ kind: 'write', id, data: 'hello\r' });
    expect(process.write.mock.calls).toEqual([['hello\r']]);
    vi.advanceTimersByTime(5000);
    expect(process.write).toHaveBeenCalledOnce();
  });

  it('accepts a command of exactly 1,000 characters', () => {
    const command = 'echo ' + 'x'.repeat(995);
    const { process } = start(command);
    vi.advanceTimersByTime(3000);
    expect(process.write).toHaveBeenCalledWith(command + '\r');
  });

  it.each([
    'x'.repeat(1001),
    'npm\trun dev',
    'echo\u202e',
    'echo\u2066',
    'echo\u200b',
    'echo\ufeff',
    'echo\u00ad',
    'echo\ud800',
    'echo\nnext',
    'echo\rnext',
    'echo\x00',
    '\x1b[31m',
    'echo\x7f',
    'echo\x85',
    'echo\u2028next',
    'echo\u2029next',
  ])('refuses invalid private input before spawning: %j', (command) => {
    start(command);
    expect(fake.spawn).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'The private terminal command is invalid.',
      }),
    );
  });

  it.each([{ readOnly: true }, { input: false }])(
    'refuses initial input for a restricted PTY: %j',
    (options) => {
      start('npm run dev', options);
      expect(fake.spawn).not.toHaveBeenCalled();
    },
  );
});
