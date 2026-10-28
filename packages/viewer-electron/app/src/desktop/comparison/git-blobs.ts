import { spawn } from 'node:child_process';
import { gitEnvironment, gitSafeOptions } from './git';

/** One raw-object process for a checkout. Backpressure retains at most one blob,
 * rather than spawning Git for every file or buffering the repository. */
export async function* gitBlobs(
  repo: string,
  objects: readonly { object: string; size: number }[],
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  signal.throwIfAborted();
  if (!objects.length) return;
  const child = spawn('/usr/bin/git', [...gitSafeOptions, '-C', repo, 'cat-file', '--batch'], {
    env: gitEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    signal,
    windowsHide: true,
  });
  let error: Error | undefined,
    diagnostics = '';
  child.on('error', (value) => {
    error ??= value;
  });
  child.stdin.on('error', (value) => {
    error ??= value;
  });
  const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
  child.stderr.on('data', (bytes: Buffer) => {
    if (diagnostics.length + bytes.length <= 65536) diagnostics += bytes.toString('utf8');
    else {
      error ??= new Error('Git object diagnostics exceeded their limit.');
      child.kill('SIGKILL');
    }
  });
  child.stdin.end(objects.map(({ object }) => object + '\n').join(''));
  const iterator = child.stdout[Symbol.asyncIterator]();
  let remaining = Buffer.alloc(0);
  const more = async () => {
    signal.throwIfAborted();
    const next = await iterator.next();
    if (next.done) throw error ?? new Error('Git ended before returning the checkout objects.');
    remaining = next.value;
  };
  const take = async (length: number): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let needed = length;
    while (needed) {
      if (!remaining.length) await more();
      const count = Math.min(remaining.length, needed);
      chunks.push(remaining.subarray(0, count));
      remaining = remaining.subarray(count);
      needed -= count;
    }
    return Buffer.concat(chunks, length);
  };
  try {
    for (const object of objects) {
      let line = '';
      while (!line.endsWith('\n')) {
        if (line.length >= 200) throw new Error('Invalid Git object header.');
        line += (await take(1)).toString('ascii');
      }
      if (line !== `${object.object} blob ${object.size}\n`)
        throw new Error('The checkout object metadata changed.');
      const bytes = await take(object.size);
      if ((await take(1))[0] !== 10) throw new Error('Invalid Git object boundary.');
      yield bytes;
    }
    if (remaining.length || !(await iterator.next()).done)
      throw new Error('Unexpected Git object output.');
    const code = await closed;
    if (error) throw error;
    if (code !== 0) throw new Error(diagnostics.slice(0, 1000) || 'Git object reading failed.');
  } finally {
    // An abandoned read stops the child; checkout files and diagnostics are retained.
    if (child.exitCode === null) child.kill('SIGKILL');
    await closed;
  }
}
