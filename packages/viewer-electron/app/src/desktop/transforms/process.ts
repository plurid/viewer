import { spawn } from 'node:child_process';

/** Process ports accept argument vectors built by typed executors only. This is
 * deliberately not exposed as an IPC method or a configurable executable. */
export function runProcessor(
  executable: string,
  args: string[],
  descriptors: number[],
  signal: AbortSignal,
  options: {
    outputLimit?: number;
    progress?(seconds: number): void;
    timeout?: number;
    input?: Buffer;
  } = {},
): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe', ...descriptors],
      windowsHide: true,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' },
    });
    if (options.input) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(options.input);
    }
    const chunks: Buffer[] = [];
    let bytes = 0,
      progress = '',
      failed: Error | undefined,
      done = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      failed ??= error;
      child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const cancel = () => stop(new Error('Media task cancelled.'));
    const timer = setTimeout(
      () =>
        stop(new Error('Media processing timed out. Its sources and partial output were kept.')),
      options.timeout ?? 600000,
    );
    signal.addEventListener('abort', cancel, { once: true });
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
      signal.removeEventListener('abort', cancel);
      if (failed || error) reject(failed ?? error);
      else resolve(Buffer.concat(chunks));
    };
    child.once('error', finish);
    child.once('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              `Media processor failed (${code ?? 'signal'}). Check the file and export format, then try again.`,
            ),
      ),
    );
    if (signal.aborted) cancel();
  });
}
