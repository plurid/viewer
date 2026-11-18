import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  masterStatus,
  RemoteControl,
  signInTimeoutMs,
  testSSHExecutable,
} from '../src/desktop/remote/control';
import type { SSHRunner } from '../src/desktop/remote/control';
import { remoteConnection } from '../src/domain/remote/connections';
import { remoteLimits } from '../src/domain/remote/limits';
import { temporaryRoot } from '../tools/temporary';

const record = remoteConnection.parse({ id: 'server01', name: 'Build', host: 'build-box' });
let sockets: string;
const controls: RemoteControl[] = [];

beforeAll(async () => {
  sockets = await temporaryRoot('viewer-control-', '/private/tmp');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(controls.splice(0).map((control) => control.close()));
});

function control(runner: SSHRunner) {
  const value = new RemoteControl({ runner, temporaryDirectory: sockets });
  controls.push(value);
  return value;
}

const isCheck = (args: string[]) => args.includes('-O') && args.includes('check');

describe('master control', () => {
  it('reports a master that is still signing in as gone, without asking ssh', async () => {
    let finish: (() => void) | undefined;
    const runner = vi.fn<SSHRunner>(async (command) =>
      command.args.includes('-O')
        ? { code: 0, stderr: 'Master running (pid=10)\r\n' }
        : await new Promise((resolve) => {
            finish = () => resolve({ code: 0, stderr: '' });
          }),
    );
    const masters = control(runner);
    const connecting = masters.connect(record, {}, false);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(await masters.check(record.id)).toBe('gone');
    expect(runner.mock.calls.filter(([command]) => isCheck(command.args))).toHaveLength(0);
    finish!();
    await connecting;
    expect(await masters.check(record.id)).toBe('running');
  });

  it('starts at most eight masters', async () => {
    const masters = control(async () => ({ code: 0, stderr: 'Master running (pid=10)\r\n' }));
    for (let index = 0; index < remoteLimits.connections; index++) {
      await masters.connect({ ...record, id: 'server0' + index }, {}, false);
    }
    await expect(masters.connect({ ...record, id: 'server09' }, {}, false)).rejects.toThrow(
      'Disconnect a server',
    );
  });

  it('never calls a master ready when its sign-in was canceled as ssh returned', async () => {
    const controller = new AbortController();
    const masters = control(async (command) => {
      if (!isCheck(command.args)) {
        controller.abort();
      }
      return { code: 0, stderr: 'Master running (pid=10)\r\n' };
    });
    await expect(masters.connect(record, {}, false, controller.signal)).rejects.toThrow('canceled');
    expect(masters.controlPath(record.id)).toBeUndefined();
  });

  it('gives a clicked sign-in the time to answer, and every jump host its own connect time', () => {
    const connect = remoteLimits.sshConnectTimeoutSeconds * 1000;
    const jumps = { ...record, jump: ['first', 'second'] };
    expect(signInTimeoutMs(record, false)).toBe(connect + 5000);
    expect(signInTimeoutMs(jumps, false)).toBe(3 * connect + 5000);
    expect(signInTimeoutMs(record, true)).toBe(remoteLimits.promptTimeoutMs + connect + 5000);
  });

  it('passes the sign-in timeout to ssh', async () => {
    const runner = vi.fn<SSHRunner>(async () => ({
      code: 0,
      stderr: 'Master running (pid=10)\r\n',
    }));
    const masters = control(runner);
    await masters.connect({ ...record, jump: ['first'] }, {}, true);
    expect(runner.mock.calls[0]![1].timeoutMs).toBe(
      signInTimeoutMs({ ...record, jump: ['first'] }, true),
    );
  });

  it('reads the process OpenSSH names for a socket, and nothing from other text', () => {
    expect(masterStatus({ code: 0, stderr: 'Master running (pid=20873)\r\n' })).toEqual({
      state: 'running',
      pid: 20873,
    });
    expect(masterStatus({ code: 0, stderr: '' })).toEqual({ state: 'running' });
    expect(
      masterStatus({ code: 255, stderr: 'Control socket connect(c1): Connection refused\r\n' }),
    ).toEqual({ state: 'gone' });
    expect(masterStatus({ code: null, stderr: '' })).toEqual({ state: 'unknown' });
  });
});

describe('the ssh executable', () => {
  it('is the system’s outside preserved tests, and an absolute path within them', () => {
    vi.stubEnv('VIEWER_TEST_PRESERVE', '1');
    expect(testSSHExecutable()).toBe('/usr/bin/ssh');
    expect(testSSHExecutable('/fixtures/ssh')).toBe('/fixtures/ssh');
    expect(() => testSSHExecutable('fixtures/ssh')).toThrow('preserved tests');
    vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
    expect(() => testSSHExecutable('/fixtures/ssh')).toThrow('preserved tests');
    expect(testSSHExecutable()).toBe('/usr/bin/ssh');
  });
});
