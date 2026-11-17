import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import { opendir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { lstat } from '../files/stats';

export type ProcessorInput = Buffer | Readable;

/** Never follow scratch links into another volume or let a directory tree make monitoring unbounded. */
export async function scratchBytes(directory: string): Promise<number> {
  let bytes = 0;
  let entries = 0;
  const pending = [{ directory, depth: 0 }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > 8)
      throw new Error('The processor scratch space exceeded its inspection limit.');
    const folder = await opendir(current.directory);
    for await (const entry of folder) {
      if (++entries > 4096)
        throw new Error('The processor scratch space exceeded its inspection limit.');
      const file = path.join(current.directory, entry.name);
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!info) continue;
      if (info.isSymbolicLink()) throw new Error('The processor scratch space contains a link.');
      if (!info.isFile() && !info.isDirectory())
        throw new Error('The processor scratch space contains an unexpected item.');
      bytes += info.size;
      if (info.isDirectory()) pending.push({ directory: file, depth: current.depth + 1 });
    }
  }
  return bytes;
}

/** Keep flags inside typed executors so IPC cannot supply arbitrary argument vectors. */
export function runProcessor(
  executable: string,
  args: string[],
  descriptors: number[],
  signal: AbortSignal,
  options: {
    outputLimit?: number;
    progress?(seconds: number): void;
    timeout?: number;
    input?: ProcessorInput;
    cwd?: string;
    lowPriority?: boolean;
    processGroup?: boolean;
    tempDirectory?: string;
    scratchLimit?: number;
  } = {},
): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const group = !!options.processGroup && process.platform !== 'win32';
    const child = spawn(executable, args, {
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe', ...descriptors],
      windowsHide: true,
      cwd: options.cwd,
      detached: group,
      env: {
        PATH: '/usr/bin:/bin',
        LC_ALL: 'C',
        LANG: 'C',
        ...(options.tempDirectory ? { TMPDIR: options.tempDirectory } : {}),
      },
    });
    let priorityFailed = false;
    if (options.lowPriority && child.pid) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch (error) {
        // An already-exited child needs no scheduling change; a live converter must stay bounded.
        const failure = error as NodeJS.ErrnoException & { info?: { code?: string } };
        priorityFailed = failure.code !== 'ESRCH' && failure.info?.code !== 'ESRCH';
      }
    }
    const chunks: Buffer[] = [];
    let bytes = 0,
      progress = '',
      failed: Error | undefined,
      done = false,
      processExited = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    let drain: ReturnType<typeof setTimeout> | undefined;
    let watcher: ReturnType<typeof setInterval> | undefined;
    let checking = false;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (group && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
      }
    };
    const stop = (error: Error) => {
      if (done) return;
      failed ??= error;
      if (processExited) return;
      kill('SIGTERM');
      force ??= setTimeout(() => kill('SIGKILL'), 2000);
    };
    const cancel = () => stop(new Error('The media task was canceled.'));
    if (priorityFailed) stop(new Error('The converter could not start at background priority.'));
    const timer = setTimeout(
      () =>
        stop(new Error('Media processing timed out. Its sources and partial output were kept.')),
      options.timeout ?? 600000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (options.scratchLimit && options.tempDirectory) {
      const inspect = async () => {
        if (checking || done || processExited) return;
        checking = true;
        try {
          const size = await scratchBytes(options.tempDirectory!);
          if (!processExited && size > options.scratchLimit!)
            stop(new Error('The processor scratch space exceeded its inspection limit.'));
        } catch (error) {
          if (!processExited)
            stop(
              error instanceof Error
                ? error
                : new Error('The processor scratch space could not be checked.'),
            );
        } finally {
          checking = false;
        }
      };
      watcher = setInterval(() => void inspect(), 50);
    }
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stop(new Error('The processor input could not be read.'));
    });
    if (options.input) {
      if (Buffer.isBuffer(options.input)) child.stdin?.end(options.input);
      else {
        options.input.once('error', () =>
          stop(new Error('The processor input could not be read.')),
        );
        if (child.stdin) options.input.pipe(child.stdin);
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (options.progress) {
        progress = (progress + chunk.toString('utf8')).slice(-65536);
        let end: number;
        while ((end = progress.indexOf('\n')) >= 0) {
          const line = progress.slice(0, end);
          progress = progress.slice(end + 1);
          if (line.startsWith('out_time_us=')) {
            const value = Number(line.slice(12)) / 1_000_000;
            if (Number.isFinite(value)) options.progress(Math.max(0, value));
          }
        }
      } else {
        bytes += chunk.length;
        if (bytes > (options.outputLimit ?? 1_000_000))
          stop(new Error('The processor output exceeded its inspection limit.'));
        else chunks.push(chunk);
      }
    });
    // Drain diagnostics without retaining media metadata or file content in the Journal.
    child.stderr?.on('data', () => {});
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(force);
      clearTimeout(drain);
      clearInterval(watcher);
      signal.removeEventListener('abort', cancel);
      if (options.input && !Buffer.isBuffer(options.input)) options.input.destroy();
      if (group) {
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
      if (failed || error) reject(failed ?? error);
      else resolve(Buffer.concat(chunks));
    };
    child.once('error', finish);
    const exited = (code: number | null) => {
      processExited = true;
      const error =
        code === 0
          ? undefined
          : new Error(
              `Media processor failed (${code ?? 'signal'}). Check the file and export format, then try again.`,
            );
      if (!group) return finish(error);
      kill('SIGKILL');
      clearTimeout(timer);
      clearTimeout(force);
      clearInterval(watcher);
      // Flush already-written PDF bytes, but descendants holding a pipe never own the render slot.
      if (child.stdout?.readableEnded) finish(error);
      else {
        child.stdout?.once('end', () => finish(error));
        drain = setTimeout(() => finish(error), 100);
      }
    };
    child.once(group ? 'exit' : 'close', exited);
    if (signal.aborted) cancel();
  });
}
