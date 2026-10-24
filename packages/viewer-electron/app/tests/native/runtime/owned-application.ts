import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { assertOwnedFixtureDirectory } from '../../../tools/temporary';

export type NativeWindowMode = 'hidden' | 'foreground';

export interface OwnedApplicationOptions {
  binary: string;
  /** A new path for prepareOwnedApplication, or an owned fixture for adoptGeneratedProfile. */
  profile: string;
  mode: NativeWindowMode;
  label: string;
  evidenceRoot: string;
  environment?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
}

export interface OwnedLaunch {
  child: ChildProcessByStdio<null, Readable, Readable>;
  port: number;
  debuggerOrigin: string;
  evidenceDirectory: string;
  output(): string;
  stop(): Promise<void>;
}

export interface OwnedApplication {
  profile: string;
  evidenceDirectory: string;
  launch(): Promise<OwnedLaunch>;
}

const maximumOutputCharacters = 1024 * 1024;

async function retainedLogs(directory: string) {
  const handles = await Promise.allSettled([
    open(path.join(directory, 'stdout.log'), 'wx', 0o600),
    open(path.join(directory, 'stderr.log'), 'wx', 0o600),
  ]);
  if (handles[0].status === 'fulfilled' && handles[1].status === 'fulfilled')
    return {
      stdout: handles[0].value.createWriteStream(),
      stderr: handles[1].value.createWriteStream(),
    };
  for (const handle of handles) if (handle.status === 'fulfilled') await handle.value.close();
  for (const handle of handles) if (handle.status === 'rejected') throw handle.reason;
  throw new Error('Native log files could not be opened.');
}

async function settlesWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function prepareApplication(
  options: OwnedApplicationOptions,
  profileOrigin: 'new' | 'generated',
): Promise<OwnedApplication> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.label))
    throw new Error('Native evidence labels use lowercase letters, numbers and hyphens.');
  if (options.mode !== 'hidden' && options.mode !== 'foreground')
    throw new Error('Choose an explicit hidden or foreground native window mode.');
  const removalSetting =
    options.environment?.VIEWER_TEST_NO_REMOVAL ?? process.env.VIEWER_TEST_NO_REMOVAL;
  const noRemoval = removalSetting === '0' ? '0' : '1';
  if (noRemoval === '0' && options.mode !== 'foreground')
    throw new Error('Native removal requires a foreground session with the operator.');
  const startupTimeout = options.startupTimeoutMs ?? 30_000;
  if (!Number.isFinite(startupTimeout) || startupTimeout <= 0 || startupTimeout > 120_000)
    throw new Error('Native startup timeout must be between 1 and 120,000 milliseconds.');
  const binary = path.resolve(options.binary);
  const profile = path.resolve(options.profile);
  const evidenceDirectory = path.join(
    path.resolve(options.evidenceRoot),
    `${options.label}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
  );
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(evidenceDirectory, 'run.json'),
    JSON.stringify(
      {
        version: 1,
        binary,
        profile,
        profileOrigin,
        mode: options.mode,
        noRemoval: noRemoval === '1',
        artifacts: 'retained',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  if (profileOrigin === 'new') {
    await mkdir(path.dirname(profile), { recursive: true });
    await mkdir(profile, { mode: 0o700 });
    await writeFile(
      path.join(profile, '.viewer-owned-native-profile.json'),
      JSON.stringify({ evidenceDirectory, created: new Date().toISOString() }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } else assertOwnedFixtureDirectory(profile);
  const identity = await lstat(profile);
  let active: ChildProcessByStdio<null, Readable, Readable> | undefined;

  let launching = false;
  async function launchNext(): Promise<OwnedLaunch> {
    if (profileOrigin === 'generated') assertOwnedFixtureDirectory(profile);
    const current = await lstat(profile);
    if (
      current.isSymbolicLink() ||
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      throw new Error('The owned native profile changed identity. It was preserved.');

    const launchDirectory = path.join(evidenceDirectory, 'launch-' + randomUUID());
    await mkdir(launchDirectory, { mode: 0o700 });
    const { stdout, stderr } = await retainedLogs(launchDirectory);
    const logProblems: string[] = [];
    const logDone = [stdout, stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.once('finish', resolve);
          stream.once('error', (error) => {
            logProblems.push(error.message);
            resolve();
          });
        }),
    );
    const args = [
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--disable-features=MacWebContentsOcclusion',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ];
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        ...options.environment,
        VIEWER_DATA_DIRECTORY: profile,
        VIEWER_RENDER_TEST: '1',
        VIEWER_BACKGROUND_TEST: options.mode === 'hidden' ? '1' : '0',
        VIEWER_TEST_PRESERVE: '1',
        VIEWER_TEST_NO_REMOVAL: noRemoval,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    active = child;
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    let output = '';
    let resolveReady!: (port: number) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<number>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-maximumOutputCharacters);
      const matches = [...output.matchAll(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//g)];
      const port = Number(matches.at(-1)?.[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) resolveReady(port);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', rejectReady);
    const timeout = setTimeout(
      () => rejectReady(new Error('The owned Viewer did not announce its debugger port.')),
      startupTimeout,
    );

    const metadata: Record<string, unknown> = {
      version: 1,
      binary,
      args,
      pid: child.pid,
      profile,
      mode: options.mode,
      noRemoval: noRemoval === '1',
      started: new Date().toISOString(),
    };
    let writes = Promise.resolve();
    const record = (fields: Record<string, unknown>) => {
      Object.assign(metadata, fields);
      const bytes = JSON.stringify(metadata, null, 2) + '\n';
      writes = writes
        .catch(() => {})
        .then(() => writeFile(path.join(launchDirectory, 'process.json'), bytes, { mode: 0o600 }));
      return writes;
    };
    const closed = new Promise<void>((resolve) => {
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        if (active === child) active = undefined;
        rejectReady(new Error(`The owned Viewer exited before startup (${code ?? signal}).`));
        void Promise.all(logDone)
          .then(() => record({ finished: new Date().toISOString(), code, signal, logProblems }))
          .catch((error) => logProblems.push((error as Error).message))
          .finally(resolve);
      });
    });
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (!(await settlesWithin(closed, 5000))) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        if (!(await settlesWithin(closed, 5000)))
          throw new Error(`The owned Viewer did not stop. Evidence: ${launchDirectory}`);
      }
    };
    try {
      const port = await ready;
      clearTimeout(timeout);
      await record({ port, debuggerOrigin: `http://127.0.0.1:${port}` });
      return {
        child,
        port,
        debuggerOrigin: `http://127.0.0.1:${port}`,
        evidenceDirectory: launchDirectory,
        output: () => output,
        stop,
      };
    } catch (error) {
      clearTimeout(timeout);
      await stop();
      throw new Error(
        `${(error as Error).message}\n${output.slice(-3000)}\nEvidence: ${launchDirectory}`,
        { cause: error },
      );
    }
  }
  return {
    profile,
    evidenceDirectory,
    async launch() {
      if (launching || (active && active.exitCode === null && active.signalCode === null))
        throw new Error('The owned Viewer is already running. Quit it before a cold restart.');
      launching = true;
      try {
        return await launchNext();
      } finally {
        launching = false;
      }
    },
  };
}

/** Creates a unique profile and evidence; neither is ever removed by this harness. */
export function prepareOwnedApplication(
  options: OwnedApplicationOptions,
): Promise<OwnedApplication> {
  return prepareApplication(options, 'new');
}

/** Reuses only a profile under an intact fixture root created by this process. */
export function adoptGeneratedProfile(options: OwnedApplicationOptions): Promise<OwnedApplication> {
  return prepareApplication(options, 'generated');
}
