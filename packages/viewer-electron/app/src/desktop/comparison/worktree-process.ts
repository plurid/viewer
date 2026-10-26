import { spawn } from 'node:child_process';
import { gitActionEnvironment } from './git-actions';

/** Human-only fixed Git write operation. Repository hooks/filters keep ordinary Git behavior. */
export function addWorktree(
  directory: string,
  destination: string,
  branch: { name: string; commit: string; fresh: boolean },
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/git',
      [
        '--no-pager',
        '--no-replace-objects',
        '-c',
        'gc.auto=0',
        '-c',
        'maintenance.auto=false',
        '-C',
        directory,
        'worktree',
        'add',
        ...(branch.fresh ? ['-b', branch.name] : []),
        '--',
        destination,
        branch.fresh ? branch.commit : branch.name,
      ],
      {
        env: { ...gitActionEnvironment('commit'), GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    );
    let output = '',
      size = 0,
      failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (force = false) => {
      try {
        if (child.pid && process.platform !== 'win32')
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        else child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* The process group may already have exited. */
      }
    };
    const cancel = () => {
      failure ??=
        signal.reason instanceof Error ? signal.reason : new Error('Worktree creation stopped.');
      kill();
      killTimer ??= setTimeout(() => kill(true), 1500);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const receive = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        failure ??= new Error('Git worktree output exceeded its limit.');
        kill(true);
      } else output += chunk.toString('utf8');
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('error', (error) => {
      failure ??= error;
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(output.trim().slice(-4000) || 'Git worktree creation failed.'));
      else resolve();
    });
  });
}
