import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateTerminalGroup } from '../src/desktop/terminal-groups';
afterEach(() => vi.restoreAllMocks());
describe('owned PTY groups', () => {
  it('kills only the recorded process group and waits until it no longer exists', async () => {
    const kill = vi
      .spyOn(process, 'kill')
      .mockImplementationOnce(() => true)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      });
    await terminateTerminalGroup(9999999);
    expect(kill.mock.calls).toEqual([
      [process.platform === 'win32' ? 9999999 : -9999999, 'SIGKILL'],
      [process.platform === 'win32' ? 9999999 : -9999999, 0],
    ]);
  });
  it('does not turn a denied signal into successful cleanup', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    });
    await expect(terminateTerminalGroup(9999999)).rejects.toMatchObject({ code: 'EPERM' });
  });
  it('rejects invalid or system-wide signal targets without calling kill', async () => {
    const kill = vi.spyOn(process, 'kill');
    for (const pid of [0, 1, -1, NaN, 2.5])
      await expect(terminateTerminalGroup(pid)).rejects.toThrow('Invalid owned');
    expect(kill).not.toHaveBeenCalled();
  });
});
