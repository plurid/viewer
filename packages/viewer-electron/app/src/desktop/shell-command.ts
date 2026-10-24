import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface ShellCommandStatus {
  path: string;
  installed: boolean;
  problem?: string;
}

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Installation never replaces a file; uninstall is an identity-checked native Trash action. */
export class ShellCommand {
  readonly file: string;
  private readonly script: string;

  constructor(
    home: string,
    executable: string,
    private trash: (file: string) => Promise<void>,
    private confirm: (file: string) => Promise<boolean>,
    private available = true,
  ) {
    this.file = path.join(home, '.local', 'bin', 'viewer');
    this.script = `#!/bin/sh\n# Viewer shell command v1\nexec ${quote(executable)} "$@"\n`;
  }

  private async inspect(): Promise<{ identity: string; text: string } | undefined> {
    if (!(await this.parent(false))) return undefined;
    try {
      const handle = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 32768)
          throw new Error('The shell command path is occupied by another item.');
        const text = await handle.readFile('utf8');
        const after = await handle.stat();
        if (info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs)
          throw new Error('The shell command changed while it was inspected.');
        const hash = createHash('sha256').update(text).digest('hex');
        return { identity: `${info.dev}:${info.ino}:${info.mtimeMs}:${hash}`, text };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async status(): Promise<ShellCommandStatus> {
    if (!this.available)
      return {
        path: this.file,
        installed: false,
        problem: 'Shell integration is available in the direct build only.',
      };
    try {
      const value = await this.inspect();
      return {
        path: this.file,
        installed: value?.text === this.script,
        problem:
          value && value.text !== this.script
            ? 'This path contains another command. It will be preserved.'
            : undefined,
      };
    } catch (error) {
      return { path: this.file, installed: false, problem: (error as Error).message };
    }
  }

  private async parent(create = true): Promise<boolean> {
    const home = path.dirname(path.dirname(path.dirname(this.file)));
    for (const folder of [path.join(home, '.local'), path.dirname(this.file)]) {
      try {
        await lstat(folder);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return false;
        await mkdir(folder);
      }
      const info = await lstat(folder);
      const expected = path.join(await realpath(home), path.relative(home, folder));
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(folder)) !== expected)
        throw new Error('The shell command directory must not contain symbolic links.');
    }
    return true;
  }

  async install(): Promise<ShellCommandStatus> {
    if (!this.available) throw new Error('Shell integration is unavailable in this build.');
    const existing = await this.inspect();
    if (existing) {
      if (existing.text !== this.script)
        throw new Error(
          'The existing command was preserved. Choose another installation before continuing.',
        );
      return this.status();
    }
    await this.parent();
    await writeFile(this.file, this.script, { flag: 'wx', mode: 0o755 });
    return this.status();
  }

  async uninstall(): Promise<ShellCommandStatus> {
    if (!this.available) throw new Error('Shell integration is unavailable in this build.');
    const before = await this.inspect();
    if (!before) return this.status();
    if (before.text !== this.script)
      throw new Error(
        'The existing command was preserved because it is not this Viewer installation.',
      );
    if (!(await this.confirm(this.file))) return this.status();
    const after = await this.inspect();
    if (after?.identity !== before.identity)
      throw new Error('The command changed after confirmation. It was preserved.');
    await this.trash(this.file);
    return this.status();
  }
}
