import { setTimeout as delay } from 'node:timers/promises';
/** PIDs come only from the owned PTY worker. The worker starts a new session;
 * its process group must be reaped even if the worker crashes first. */
export async function terminateTerminalGroup(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned terminal process.');
  const target = process.platform === 'win32' ? pid : -pid;
  try {
    process.kill(target, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw error;
  }
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    try {
      process.kill(target, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await delay(25);
  }
  throw new Error('The owned terminal process group did not stop.');
}
