import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { access, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import type * as NativePty from 'node-pty';
import type { Terminal } from '@xterm/xterm';
import { terminalWindowOptions } from '../src/domain/terminals/window-options';
import type {
  TerminalWorkerReply,
  TerminalWorkerRequest,
} from '../src/desktop/terminals/terminal-protocol';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const fake = vi.hoisted(() => ({
  receive: undefined as ((event: { data: TerminalWorkerRequest }) => void) | undefined,
  postMessage: vi.fn<(event: TerminalWorkerReply) => void>(),
  writes: [] as string[],
}));
vi.mock('../src/desktop/workers/worker-port', () => ({
  workerPort: {
    postMessage: fake.postMessage,
    on: (_type: string, receive: typeof fake.receive) => {
      fake.receive = receive;
    },
  },
}));
vi.mock('node-pty', () => {
  const require = createRequire(import.meta.url);
  const native = require(process.env.VIEWER_TEST_PTY_MODULE || 'node-pty') as typeof NativePty;
  return {
    spawn: (...args: Parameters<typeof native.spawn>) => {
      const process = native.spawn(...args);
      const write = process.write.bind(process);
      process.write = (data: string) => {
        fake.writes.push(data);
        write(data);
      };
      return process;
    },
  };
});

let root: string;
let id: string;
let next = 0;
let events: TerminalWorkerReply[];
const send = (request: TerminalWorkerRequest) => fake.receive?.({ data: request });
const output = () =>
  events
    .filter((event) => event.type === 'data')
    .map((event) => (event.type === 'data' ? event.data : ''))
    .join('');
const command = 'print -r -- VIEWER_NATIVE_$((40+2))';
const typedCommand = '\x1bS\x15' + command + '\r';
type NativeShell = 'zsh' | 'bash';

describe('initial input through a real zsh worker', () => {
  let unavailable = '';
  beforeAll(async () => {
    const probeRoot = await realpath(await temporaryRoot('viewer-initial-pty-probe-'));
    let probe: IPty | undefined;
    try {
      await access('/bin/zsh', constants.X_OK);
      const require = createRequire(import.meta.url);
      const native = require(process.env.VIEWER_TEST_PTY_MODULE || 'node-pty') as typeof NativePty;
      probe = native.spawn('/bin/zsh', ['-f', '-c', 'exit 0'], {
        cwd: probeRoot,
        env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', ZDOTDIR: probeRoot },
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          probe?.kill();
          reject(new Error('PTY probe timed out'));
        }, 2000);
        probe!.onExit(({ exitCode }) => {
          clearTimeout(timer);
          if (exitCode) reject(new Error('PTY probe exited with an error'));
          else resolve();
        });
      });
    } catch (error) {
      if (process.env.VIEWER_TEST_PTY_MODULE) throw error;
      unavailable =
        'Real zsh cases skipped: /bin/zsh or a host-compatible node-pty spawn helper is unavailable. See docs/development/testing.md, Command startup with real zsh.';
      console.info(unavailable);
    }
  });
  beforeEach(async (context) => {
    if (unavailable) context.skip(unavailable);
    root = await realpath(await temporaryRoot('viewer-initial-real-pty-'));
    id = `real-initial-${++next}`;
    events = [];
    fake.writes = [];
    fake.postMessage.mockReset().mockImplementation((event) => {
      events.push(event);
    });
    await import('../src/desktop/terminals/terminal-worker');
  });
  afterEach(async () => {
    if (unavailable) return;
    send({ kind: 'close', id });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'exit')).toBe(true));
    await trashTemporary(root);
  });

  async function start(
    rc: string,
    initialInput = command,
    shell: NativeShell = 'zsh',
  ): Promise<void> {
    const rcFile = path.join(root, shell === 'zsh' ? '.zshrc' : '.bashrc');
    await writeFile(rcFile, rc, { flag: 'wx' });
    send({
      kind: 'start',
      id,
      workspaceID: 'workspace',
      rootID: 'folder',
      profileID: 'login',
      cwd: root,
      executable: '/bin/' + shell,
      args: shell === 'zsh' ? ['-i'] : ['--rcfile', rcFile, '-i'],
      env: {
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        ZDOTDIR: root,
        BASH_SILENCE_DEPRECATION_WARNING: '1',
      },
      cols: 80,
      rows: 24,
      initialInput,
    });
  }

  it.each([
    ['N, genuine DCS with history', '\x1bP1$r0m\x1b\\', false, true],
    [
      'G, crafted DCS during an rc read',
      '\x1bP1$r; echo INJECTED_BY_DCS_$((40+2)); : m\x1b\\',
      true,
      true,
    ],
    [
      'G2, crafted DCS after the rc moves on',
      '\x1bP1$r; echo INJECTED_BY_DCS_$((40+2)); : m\x1b\\',
      false,
      true,
    ],
    ['unsolicited DCS followed by Return', '\x1bP1$r0m\x1b\\', false, false],
  ] as const)(
    'drops %s on real zsh without recalling history or running pasted text',
    async (_name, reply, reads, queries) => {
      const approved = 'echo WP3A_RAN_$((40+2))';
      await writeFile(path.join(root, 'history'), 'touch FROM_HISTORY_MARKER\n', { flag: 'wx' });
      let answered = false;
      fake.postMessage.mockImplementation((event) => {
        events.push(event);
        if (queries && !answered && event.type === 'data' && output().includes('\x1bP$qm\x1b\\')) {
          answered = true;
          send({ kind: 'write', id, data: reply });
        }
      });
      await start(
        [
          'bindkey -e',
          'HISTSIZE=100',
          'SAVEHIST=0',
          'fc -R "$ZDOTDIR/history"',
          ...(queries ? ["print -n -- $'\\eP$qm\\e\\\\'"] : []),
          ...(reads ? ['read -s -t 1 -d "\\\\" reply', 'print -r -- DCS_READ_FINISHED'] : []),
          "PS1='fixture> '",
          '',
        ].join('\n'),
        approved,
      );
      if (!queries) send({ kind: 'write', id, data: reply + '\r' });
      await vi.waitFor(() => expect(output()).toContain('WP3A_RAN_42'), { timeout: 5000 });
      expect(output().split('WP3A_RAN_42')).toHaveLength(2);
      expect(output()).not.toContain('INJECTED_BY_DCS_42');
      expect(
        (await readdir(root)).filter((file) => file.startsWith('FROM_HISTORY_MARKER')),
      ).toEqual([]);
      expect(fake.writes).not.toContain(reply);
      expect(fake.writes[0]).toBe('\x1bS\x15' + approved + '\r');
    },
  );

  it.each(['K, delayed CPR', 'H, Escape then CPR'])(
    'keeps %s from swallowing the approved command on real zsh',
    async (mode) => {
      let answered = false;
      fake.postMessage.mockImplementation((event) => {
        events.push(event);
        if (!answered && event.type === 'data' && output().includes('\x1b[6n')) {
          answered = true;
          const respond = () => {
            if (mode.startsWith('H')) send({ kind: 'write', id, data: '\x1b' });
            send({ kind: 'write', id, data: '\x1b[5;1R' });
          };
          if (mode.startsWith('K')) setTimeout(respond, 200);
          else respond();
        }
      });
      await start(
        "print -n -- $'\\e[6n'\nread -s -t 1 -d R reply\nprint -r -- CPR_READ_FINISHED\nPS1='fixture> '\n",
      );
      await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
      expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
      expect(output()).not.toContain('command not found');
      expect(fake.writes.slice(0, 2)).toEqual(['\x1b[5;1R', typedCommand]);
    },
  );

  it('cancels an unanswered CPR at the deadline on real zsh without typing any command fragment', async () => {
    await start("print -n -- $'\\e[6n'\nread -s -t 5 -d R reply\nPS1='fixture> '\n");
    send({ kind: 'write', id, data: 'held human input' });
    await vi.waitFor(() => expect(output()).toContain('waiting for an answer'), { timeout: 5000 });
    expect(fake.writes).toEqual(['held human input']);
    expect(output()).not.toContain('VIEWER_NATIVE_42');
  });

  it('waits for a DECRQSS read to time out and resume output before typing into real zsh', async () => {
    await start(
      "print -n -- $'\\eP$qm\\e\\\\'\nread -s -t 1 -d \"\\\\\" reply\nprint -r -- DCS_TIMEOUT_FINISHED\nPS1='fixture> '\n",
    );
    await vi.waitFor(() => expect(output()).toContain('\x1bP$qm\x1b\\'));
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(fake.writes).toEqual([]);
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    expect(output().indexOf('DCS_TIMEOUT_FINISHED')).toBeLessThan(
      output().indexOf('VIEWER_NATIVE_42'),
    );
    expect(fake.writes).toEqual([typedCommand]);
  });

  it('drops a DCS answer and cancels if the DECRQSS read stays blocked past the deadline on real zsh', async () => {
    let answered = false;
    fake.postMessage.mockImplementation((event) => {
      events.push(event);
      if (!answered && event.type === 'data' && output().includes('\x1bP$qm\x1b\\')) {
        answered = true;
        send({ kind: 'write', id, data: '\x1bP1$r0m\x1b\\' });
      }
    });
    await start("print -n -- $'\\eP$qm\\e\\\\'\nread -s -t 5 -d \"\\\\\" reply\nPS1='fixture> '\n");
    send({ kind: 'write', id, data: 'held human input' });
    await vi.waitFor(() => expect(output()).toContain('waiting for an answer'), { timeout: 5000 });
    expect(answered).toBe(true);
    expect(fake.writes).toEqual(['held human input']);
    expect(output()).not.toContain('VIEWER_NATIVE_42');
  });

  it.each([
    ['cursor', '\x1b[6n', '\x1b[5;1R'],
    ['status', '\x1b[5n', '\x1b[0n'],
    ['size', '\x1b[18t', '\x1b[8;24;80t'],
  ])('answers a startup %s query before typing the command', async (_name, query, reply) => {
    let answered = false;
    const native = createRequire(import.meta.url)('@xterm/xterm') as { Terminal: typeof Terminal };
    const emulator = new native.Terminal({
      cols: 80,
      rows: 24,
      windowOptions: terminalWindowOptions,
    });
    emulator.onData((data) => {
      if (_name === 'size') send({ kind: 'write', id, data });
    });
    fake.postMessage.mockImplementation((event) => {
      events.push(event);
      if (_name === 'size' && event.type === 'data') emulator.write(event.data);
      if (!answered && event.type === 'data' && output().includes(query)) {
        answered = true;
        if (_name !== 'size') send({ kind: 'write', id, data: reply });
      }
    });
    await start(
      `print -n -- $'${query.replace('\x1b', '\\e')}'\nread -rk ${reply.length} reply\nprint -r -- QUERY_ANSWERED\nPS1='fixture> '\n`,
    );
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    expect(answered).toBe(true);
    expect(output()).toContain('QUERY_ANSWERED');
    expect(output()).not.toContain('command not found');
    expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
    expect(fake.writes.slice(0, 2)).toEqual([reply, typedCommand]);
    expect(Object.keys(terminalWindowOptions)).toEqual(['getWinSizeChars']);
    emulator.dispose();
  });

  it.each([
    ['OSC with CR', '\x1b]0;\recho AHEAD_OF_COMMAND\r\x07', false, false],
    ['OSC with text and BEL', '\x1b]echo INSTEAD_OF_COMMAND; #\x07', false, false],
    ['OSC with text and ST', '\x1b]echo INSTEAD_OF_COMMAND; #\x1b\\', false, false],
    ['DCS with CR', '\x1bP\recho DCS_AHEAD\r\x1b\\', false, false],
    ['OSC with LF', '\x1b]x\necho LF_AHEAD\n\x1b\\', false, false],
    ['Shift F3', '\x1b[1;2R', false, true],
    ['Ctrl F3', '\x1b[1;5R', false, true],
    ['OSC with CR during a slow rc', '\x1b]0;\recho AHEAD_OF_COMMAND\r\x07', true, false],
  ] as const)('handles %s during real zsh startup', async (_name, typed, slow, dropped) => {
    await start((slow ? '/bin/sleep 0.3\n' : '') + "PS1='fixture> '\n");
    send({ kind: 'write', id, data: typed });
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    expect(fake.writes.slice(0, 2)).toEqual([typedCommand, ...(dropped ? [] : [typed])]);
    const actual = output().indexOf('VIEWER_NATIVE_42');
    for (const marker of ['AHEAD_OF_COMMAND', 'INSTEAD_OF_COMMAND', 'DCS_AHEAD', 'LF_AHEAD']) {
      const index = output().indexOf(marker);
      if (index >= 0) expect(index).toBeGreaterThan(actual);
    }
  });

  it('preserves held human input after the command on a plain prompt', async () => {
    await start("PS1='fixture> '\n");
    send({ kind: 'write', id, data: 'print -r -- HUMAN_$((40+2))\r' });
    await vi.waitFor(() => expect(output()).toContain('HUMAN_42'), { timeout: 5000 });
    expect(output().indexOf('VIEWER_NATIVE_42')).toBeGreaterThanOrEqual(0);
    expect(output().indexOf('VIEWER_NATIVE_42')).toBeLessThan(output().indexOf('HUMAN_42'));
  });

  it('Q: leaves a zsh startup question unanswered and cancels without a command fragment', async () => {
    await start(
      "read -rk 1 'answer?Update now? [Y/n] '\nprint -r -- \"ANSWER:$answer\"\nPS1='fixture> '\n",
    );
    await vi.waitFor(() => expect(output()).toContain('Type this command manually'), {
      timeout: 5000,
    });
    expect(fake.writes).toEqual([]);
    expect(output()).not.toContain('ANSWER:');
    send({ kind: 'write', id, data: 'n' });
    await vi.waitFor(() => expect(output()).toContain('ANSWER:n'));
  });

  it("W4: delays a person's answer until the deadline, cancels the command and releases the answer", async () => {
    let answered = false;
    fake.postMessage.mockImplementation((event) => {
      events.push(event);
      if (!answered && event.type === 'data' && output().includes('Update now?')) {
        answered = true;
        send({ kind: 'write', id, data: 'n' });
      }
    });
    await start(
      "read -rk 1 'answer?Update now? [Y/n] '\nprint -r -- \"ANSWER:$answer\"\nPS1='fixture> '\n",
    );
    await vi.waitFor(() => expect(answered).toBe(true));
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(fake.writes).toEqual([]);
    await vi.waitFor(() => expect(output()).toContain('Type this command manually'), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(output()).toContain('ANSWER:n'));
    expect(fake.writes).toEqual(['n']);
    expect(output()).toContain(command);
    expect(output()).not.toContain('VIEWER_NATIVE_42');
  });

  it('W1: waits through an instant-prompt style rc and preserves early typing after the command', async () => {
    await start(
      "PS1='fixture> '\nprint -n -- 'fixture> '\n/bin/sleep 1\nprint -n -- $'\\r\\e[K'\nprint -r -- FRAMEWORK_READY\n",
    );
    send({ kind: 'write', id, data: 'print -r -- PERSON_$((40+2))\r' });
    await vi.waitFor(() => expect(output()).toContain('PERSON_42'), { timeout: 5000 });
    expect(output().indexOf('FRAMEWORK_READY')).toBeLessThan(output().indexOf('VIEWER_NATIVE_42'));
    expect(output().indexOf('VIEWER_NATIVE_42')).toBeLessThan(output().indexOf('PERSON_42'));
    expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
    expect(fake.writes).toEqual([typedCommand, 'print -r -- PERSON_$((40+2))\r']);
  });

  it('W2: waits for a slow precmd before typing once', async () => {
    await start("precmd() { /bin/sleep 0.5; print -n -- $'\\e]0;title\\a'; }\nPS1='fixture> '\n");
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
    expect(fake.writes).toEqual([typedCommand]);
  });

  it('W3: never repeats a command after an asynchronous prompt redraw', async () => {
    await start("zmodload zsh/sched\nsched +1 'print -r -- ASYNC_REDRAW'\nPS1='fixture> '\n");
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    await vi.waitFor(() => expect(output()).toContain('ASYNC_REDRAW'), { timeout: 5000 });
    expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
    expect(fake.writes).toEqual([typedCommand]);
  });

  it.each([
    ['P1', "print -r -- 'checking terminal'\nread -s -t 5 -d R reply"],
    ['P1b', 'print -n -- \'probing...\'\nread -s -t 1 -d "\\\\" reply'],
    ['P2', '( /bin/sleep 0.2; print -r -- background ) &\nread -s -t 5 -d R reply'],
    ['P4', 'read -s -t 5 -d R reply'],
  ])('%s: status and background output cannot release a DECRQSS read', async (name, read) => {
    const query =
      name === 'P4'
        ? "print -n -- $'\\eP$q'; /bin/sleep 0.05; print -n -- $'m\\e\\\\'"
        : "print -n -- $'\\eP$qm\\e\\\\'";
    await start(query + '\n' + read + "\nPS1='fixture> '\n");
    if (name === 'P1b') {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      expect(fake.writes).toEqual([]);
      await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
      expect(fake.writes).toEqual([typedCommand]);
    } else {
      await vi.waitFor(() => expect(output()).toContain('waiting for an answer'), {
        timeout: 5000,
      });
      expect(fake.writes).toEqual([]);
      expect(output()).not.toContain('VIEWER_NATIVE_42');
    }
  });

  it('P3: a DECRQSS query in PS1 clears when zsh enters its line editor', async () => {
    await start("PS1=$'fixture \\eP$qm\\e\\\\> '\n");
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    expect(fake.writes).toEqual([typedCommand]);
  });

  it('P5: enabling focus without a focus change never blocks readiness', async () => {
    await start("print -n -- $'\\e[?1004h'\nPS1='fixture> '\n");
    await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
    expect(fake.writes).toEqual([typedCommand]);
  });

  it.each([
    ['emacs', 'cursor'],
    ['emacs', 'size'],
    ['vi insert', 'cursor'],
    ['vi insert', 'size'],
    ['vi insert', 'both'],
  ] as const)(
    'clears an unread %s %s reply from the zsh line editor before the command',
    async (keymap, kind) => {
      const replies = new Map<string, string>();
      if (kind !== 'size') replies.set('\x1b[6n', '\x1b[12;1R');
      if (kind !== 'cursor') replies.set('\x1b[18t', '\x1b[8;30;100t');
      const query = [...replies.keys()].join('').replaceAll('\x1b', '\\e');
      fake.postMessage.mockImplementation((event) => {
        events.push(event);
        for (const [query, reply] of replies) {
          if (event.type === 'data' && output().includes(query)) {
            replies.delete(query);
            send({ kind: 'write', id, data: reply });
          }
        }
      });
      await start(
        [
          keymap === 'emacs' ? 'bindkey -e' : 'bindkey -v',
          `print -n -- $'${query}'`,
          "print -r -- 'rc asked and moved on'",
          "PS1='fixture> '",
          '',
        ].join('\n'),
      );
      await vi.waitFor(() => expect(output()).toContain('VIEWER_NATIVE_42'), { timeout: 5000 });
      expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
      expect(output()).not.toContain('command not found');
      expect(fake.writes.at(-1)).toBe(typedCommand);
    },
  );

  it.each(['K5 vi prefill', 'K7 emacs accept-line binding'])(
    '%s clears pre-existing text without accepting it and preserves early typing',
    async (mode) => {
      await start(
        [
          mode.startsWith('K5') ? 'bindkey -v' : "bindkey -e; bindkey '^[i' accept-line",
          "print -z 'touch PREFILL_RAN'",
          "PS1='fixture> '",
          '',
        ].join('\n'),
      );
      send({ kind: 'write', id, data: 'print -r -- PERSON_$((40+2))\r' });
      await vi.waitFor(() => expect(output()).toContain('PERSON_42'), { timeout: 5000 });
      expect(output().split('VIEWER_NATIVE_42')).toHaveLength(2);
      expect(output()).toMatch(/\r?\nVIEWER_NATIVE_42\r?\n/);
      expect(await readdir(root)).not.toContain('PREFILL_RAN');
      expect(output().indexOf('VIEWER_NATIVE_42')).toBeLessThan(output().indexOf('PERSON_42'));
      expect(fake.writes).toEqual([typedCommand, 'print -r -- PERSON_$((40+2))\r']);
    },
  );

  it('a zsh line editor with bracketed paste disabled cancels', async () => {
    await start("unset zle_bracketed_paste\nPS1='fixture> '\n");
    await vi.waitFor(() => expect(output()).toContain('Type this command manually'), {
      timeout: 5000,
    });
    expect(fake.writes).toEqual([]);
  });

  it('B1: keeps the ordinary quiet rule for a plain bash prompt', async () => {
    const input = 'echo BASH_NATIVE_$((40+2))';
    await start("PS1='fixture> '\n", input, 'bash');
    await vi.waitFor(() => expect(output()).toContain('BASH_NATIVE_42'), { timeout: 5000 });
    expect(output().split('BASH_NATIVE_42')).toHaveLength(2);
    expect(fake.writes).toEqual([input + '\r']);
  });

  it('B2: exposes the documented startup-question limit in bash', async () => {
    const input = 'echo BASH_NATIVE_$((40+2))';
    await start(
      "read -n 1 -p 'Update now? ' answer\nprintf '\\nANSWER:%s\\n' \"$answer\"\nPS1='fixture> '\n",
      input,
      'bash',
    );
    await vi.waitFor(() => expect(output()).toContain('ANSWER:e'), { timeout: 5000 });
    await vi.waitFor(() => expect(output()).toContain('command not found'));
    expect(output()).not.toContain('BASH_NATIVE_42');
    expect(fake.writes).toEqual([input + '\r']);
  });

  it('B3: cancels an unanswered DECRQSS query in bash even without a reader', async () => {
    await start(
      "printf '\\033P$qm\\033\\\\'\nPS1='fixture> '\n",
      'echo BASH_NATIVE_$((40+2))',
      'bash',
    );
    await vi.waitFor(() => expect(output()).toContain('waiting for an answer'), { timeout: 5000 });
    expect(fake.writes).toEqual([]);
    expect(output()).not.toContain('BASH_NATIVE_42');
  });
});
