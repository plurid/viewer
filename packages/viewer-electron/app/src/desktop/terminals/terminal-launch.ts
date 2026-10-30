import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ApplicationSettings } from '../../domain/services';
import type { TerminalProfile } from '../../domain/automation/actions';
import { absolute } from '../files/filesystem';
import { readApplications } from '../native/applications';
import { discardOwnTemporaryFile, removePrivateFile } from '../operations/removal';
const exec = promisify(execFile);
export const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";
/** A launcher's name: the random ID it was written under. */
const launcherName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.command$/;
export interface Launcher {
  /** The script's path, directly inside `folder`. */
  file: string;
  /** Viewer's private launch folder, links resolved. */
  folder: string;
  cwd: string;
  env: Record<string, string>;
  executable: string;
  args: readonly string[];
}
/**
 * The script a terminal app runs to open the shell. It holds the profile's environment and
 * arguments, which can carry tokens, and the app reads it at a moment Viewer never learns; a command
 * line would show them to every process. So the script removes itself as it starts (zsh reads on
 * from its open file), and only when it is the file Viewer wrote: run as itself, a regular file and
 * not a link, this user's and writable, in Viewer's private launch folder, which is this user's,
 * not a link and mode 0700. No `-r`, no `-f`; a launcher left behind goes at the next start
 * (`sweep`). This is the standing exception in AGENTS.md.
 */
export function launcherScript(launcher: Launcher): string {
  if (
    path.dirname(launcher.file) !== launcher.folder ||
    !launcherName.test(path.basename(launcher.file))
  )
    throw new Error('A terminal launcher is written directly inside its private folder.');
  const file = shellQuote(launcher.file);
  const folder = shellQuote(launcher.folder);
  const env = Object.entries(launcher.env).map(([key, value]) => key + '=' + shellQuote(value));
  const command = [...env, shellQuote(launcher.executable), ...launcher.args.map(shellQuote)];
  return [
    '#!/bin/zsh',
    `if [[ \${0:A} == ${file} ]] &&`,
    `  [[ ! -L ${file} && -f ${file} && -O ${file} && -w ${file} ]] &&`,
    `  [[ ! -L ${folder} && -d ${folder} && -O ${folder} ]] &&`,
    `  [[ $(/usr/bin/stat -f %Lp -- ${folder}) == 700 ]]`,
    'then',
    `  /bin/rm -- ${file}`,
    'fi',
    `cd -- ${shellQuote(launcher.cwd)} || exit`,
    `exec /usr/bin/env ${command.join(' ')}`,
    '',
  ].join('\n');
}
export async function executablePath(value: string): Promise<string> {
  if (value.includes('\0')) throw new Error('Invalid executable.');
  const candidates = path.isAbsolute(value)
    ? [value]
    : [
        ...new Set([
          ...(process.env.PATH || '').split(path.delimiter),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
        ]),
      ]
        .filter(Boolean)
        .map((directory) => path.join(directory, value));
  for (const file of candidates) {
    try {
      await fs.access(file, constants.X_OK);
      if ((await fs.stat(file)).isFile()) return file;
    } catch {
      /* try next directory */
    }
  }
  throw new Error(`Executable not found: ${value}. Choose its path in Settings → Terminals.`);
}
export interface TerminalApplication {
  path: string;
  name: string;
  running: boolean;
}
export interface ExternalTerminalAdapter {
  discover(): Promise<TerminalApplication[]>;
  run(executable: string, args: string[]): Promise<string>;
  open(application: string, file: string): Promise<void>;
  bundledCLI?(application: TerminalApplication): Promise<string | undefined>;
}
/** Each resolves once the person has confirmed that exact configured program natively. */
export interface TerminalConfirmations {
  profile(profile: TerminalProfile): Promise<void>;
  tmux(executable: string, socket: string, env: Record<string, string>): Promise<void>;
  application(application: string): Promise<void>;
}
const unconfirmed: TerminalConfirmations = {
  profile: async () => {},
  tmux: async () => {},
  application: async () => {},
};
export class ExternalTerminals {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private pending = 0;
  constructor(
    private directory: string,
    private settings: () => ApplicationSettings,
    helper: string,
    private adapter: ExternalTerminalAdapter = {
      discover: async () =>
        (await readApplications(helper, [], ['--terminals'])) as TerminalApplication[],
      run: async (file, args) =>
        (await exec(file, args, { timeout: 15000, maxBuffer: 1024 * 1024 })).stdout,
      bundledCLI: async (app) => {
        if (!/iterm/i.test(app.name)) return;
        // Only use the official executable inside the selected app bundle, never a same-named PATH tool.
        for (const relative of [
          'Contents/MacOS/it2',
          'Contents/Resources/it2',
          'Contents/Resources/utilities/it2',
        ]) {
          const file = path.join(app.path, relative);
          try {
            const resolved = await fs.realpath(file);
            if (resolved.startsWith(app.path + '/')) return await executablePath(resolved);
          } catch {
            /* older app: use the command-file adapter */
          }
        }
      },
      open: async (app, file) => {
        await exec('/usr/bin/open', ['-a', app, '--', file], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
      },
    },
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    private confirm: TerminalConfirmations = unconfirmed,
  ) {}
  /**
   * A launcher removes itself when the terminal app runs it (`launcherScript`); one never run
   * keeps the profile's environment. Those an earlier session wrote go at startup, one regular
   * file at a time; this session's are left to run, and nothing else in the folder is touched.
   */
  async sweep(privateRoot: string): Promise<void> {
    const started = Date.now() - process.uptime() * 1000;
    for (const name of await fs.readdir(this.directory).catch(() => [] as string[])) {
      if (!launcherName.test(name)) continue;
      const file = path.join(this.directory, name);
      const info = await fs.lstat(file).catch(() => null);
      if (info?.isFile() && info.mtimeMs < started - 60_000)
        await removePrivateFile(privateRoot, file).catch(() => {});
    }
  }
  /** The folder launchers are written to: a real folder of this user's, open to no one else. A
   * launcher checks the same before it removes itself. */
  private async launchFolder(): Promise<string> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(this.directory);
    if (!info.isDirectory() || info.uid !== process.getuid?.())
      throw new Error(
        `Viewer’s terminal launch folder, ${this.directory}, is a link or another user’s, so no ` +
          'terminal was opened. Move it to the Trash; Viewer makes a new one.',
      );
    if ((info.mode & 0o777) !== 0o700) await fs.chmod(this.directory, 0o700);
    return fs.realpath(this.directory);
  }
  async application(): Promise<TerminalApplication> {
    if (process.platform !== 'darwin')
      throw new Error(
        'External terminal adapters currently support macOS. Embedded terminals remain available.',
      );
    const configured = this.settings().terminals.application;
    const apps = await this.adapter.discover();
    if (configured !== 'auto') {
      const found = apps.find(
        (app) =>
          app.path === configured ||
          app.name.toLowerCase().replace(/2$/, '') === configured.toLowerCase().replace(/2$/, ''),
      );
      if (found) return found;
      if (
        path.isAbsolute(configured) &&
        configured.endsWith('.app') &&
        (await fs.stat(configured)).isDirectory()
      ) {
        await this.confirm.application(configured);
        return { path: configured, name: path.basename(configured, '.app'), running: false };
      }
      throw new Error(
        'The configured terminal application is unavailable. Choose another in Settings → Terminals.',
      );
    }
    const app =
      apps.find((app) => app.running) ||
      apps.find((app) => /iterm/i.test(app.name)) ||
      apps.find((app) => app.name === 'Terminal');
    if (!app)
      throw new Error(
        'No supported terminal application found. Configure its app path in Settings → Terminals.',
      );
    return app;
  }
  open(cwd: string, tmux = false): Promise<void> {
    if (this.closed) return Promise.reject(new Error('External terminal handoff has closed.'));
    if (this.pending >= 20)
      return Promise.reject(
        new Error('Wait for a terminal handoff to finish before opening more.'),
      );
    this.pending++;
    const task = this.queue
      .catch(() => {})
      .then(() => {
        if (this.closed) throw new Error('External terminal handoff has closed.');
        return this.launch(cwd, tmux);
      })
      .finally(() => {
        this.pending--;
      });
    this.queue = task;
    return task;
  }
  private async launch(cwd: string, tmux: boolean): Promise<void> {
    await this.access([cwd]);
    cwd = await fs.realpath(absolute(cwd));
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error('Choose a folder to open a terminal.');
    const application = await this.application();
    await this.access([cwd]);
    if (this.closed) throw new Error('External terminal handoff has closed.');
    const settings = this.settings().terminals;
    const profile = settings.profiles.find((profile) => profile.id === settings.profileID)!;
    // Configured programs run only once confirmed natively. With tmux, the profile's
    // environment applies but its program and arguments do not.
    if (tmux) await this.confirm.tmux(settings.tmux.executable, settings.tmux.socket, profile.env);
    else await this.confirm.profile(profile);
    await this.access([cwd]);
    if (this.closed) throw new Error('External terminal handoff has closed.');
    let executable = await executablePath(profile.executable || process.env.SHELL || '/bin/zsh');
    let args = profile.args;
    if (tmux) {
      executable = await executablePath(settings.tmux.executable);
      const prefix = settings.tmux.socket ? ['-S', settings.tmux.socket] : [];
      const target = '=' + settings.tmux.session;
      const name = settings.tmux.windowName.replace(/\{folder\}/g, path.basename(cwd));
      let existing = true;
      try {
        await this.adapter.run(executable, [...prefix, 'has-session', '-t', target]);
      } catch (error) {
        const failure = error as { code?: number; stderr?: string };
        if (
          failure.code !== 1 &&
          !/no server running|no sessions|can.t find session|error connecting/.test(
            failure.stderr || '',
          )
        )
          throw error;
        existing = false;
      }
      await this.access([cwd]);
      if (this.closed) throw new Error('External terminal handoff has closed.');
      await this.adapter.run(executable, [
        ...prefix,
        ...(existing
          ? ['new-window', '-t', target]
          : ['new-session', '-d', '-s', settings.tmux.session]),
        '-n',
        name,
        '-c',
        cwd,
        '-P',
        '-F',
        '#{window_id}',
      ]);
      if (existing) {
        const clients = await this.adapter.run(executable, [
          ...prefix,
          'list-clients',
          '-t',
          target,
          '-F',
          '#{client_control_mode}',
        ]);
        if (/iterm/i.test(application.name) && clients.split('\n').includes('1')) return;
      }
      args = [
        ...prefix,
        ...(/iterm/i.test(application.name) ? ['-CC'] : []),
        'attach-session',
        '-t',
        target,
      ];
    }
    const folder = await this.launchFolder();
    const file = path.join(folder, randomUUID() + '.command');
    const script = launcherScript({ file, folder, cwd, env: profile.env, executable, args });
    await fs.writeFile(file, script, { mode: 0o700, flag: 'wx' });
    try {
      const cli = await this.adapter.bundledCLI?.(application);
      await this.access([cwd]);
      if (this.closed) throw new Error('External terminal handoff has closed.');
      if (cli && application.running) {
        const help = await this.adapter.run(cli, ['window', 'new', '--help']).catch(() => '');
        if (help.includes('--command')) {
          await this.adapter.run(cli, [
            'window',
            'new',
            '--command',
            '/bin/zsh ' + shellQuote(file),
          ]);
          return;
        }
      }
      await this.adapter.open(application.path, file);
    } catch (error) {
      await discardOwnTemporaryFile(file);
      throw error;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.queue.catch(() => {});
  }
  async quiesce(): Promise<void> {
    await this.queue.catch(() => {});
  }
}
