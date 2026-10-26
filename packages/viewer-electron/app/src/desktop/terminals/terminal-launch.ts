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
import { discardOwnTemporaryFile, removePrivateData } from '../operations/removal';
const exec = promisify(execFile);
export const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";
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
   * A launcher removes itself when Terminal runs it (its `/bin/rm`, the one removal outside
   * `removal.ts`); one Terminal never ran kept the profile's environment there. Those an
   * earlier session wrote go at startup; this session's are left to run.
   */
  async sweep(privateRoot: string): Promise<void> {
    const started = Date.now() - process.uptime() * 1000;
    for (const name of await fs.readdir(this.directory).catch(() => [] as string[])) {
      if (!name.endsWith('.command')) continue;
      const file = path.join(this.directory, name);
      const info = await fs.lstat(file).catch(() => null);
      if (info?.isFile() && info.mtimeMs < started - 60_000)
        await removePrivateData(privateRoot, file).catch(() => {});
    }
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
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, randomUUID() + '.command');
    const env = Object.entries(profile.env).map(([key, value]) => key + '=' + shellQuote(value));
    const script =
      '#!/bin/zsh\n/bin/rm -- ' +
      shellQuote(file) +
      '\ncd -- ' +
      shellQuote(cwd) +
      ' || exit\nexec /usr/bin/env ' +
      [...env, shellQuote(executable), ...args.map(shellQuote)].join(' ') +
      '\n';
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
