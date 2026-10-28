import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ShellCommandStatus } from '../../domain/workspaces/launch';
import {
  inspectReviewedFile,
  sameReviewedFile,
  type InspectedFile,
  type ReviewedFile,
} from '../native/reviewed-file';

export type { ReviewedFile } from '../native/reviewed-file';

export type { ShellCommandStatus } from '../../domain/workspaces/launch';

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const maximumScriptBytes = 32768;

/** Installation never replaces a file; uninstall is an identity-checked native Trash action. */
export class ShellCommand {
  readonly file: string;
  private readonly script: string;

  constructor(
    home: string,
    executable: string,
    private trash: (reviewed: ReviewedFile) => Promise<void>,
    private confirm: (file: string) => Promise<boolean>,
    private available = true,
  ) {
    this.file = path.join(home, '.local', 'bin', 'viewer');
    this.script = `#!/bin/sh\n# Viewer shell command v1\nexec ${quote(executable)} "$@"\n`;
  }

  private async inspect(): Promise<InspectedFile | undefined> {
    if (!(await this.parent(false))) return undefined;
    try {
      return await inspectReviewedFile(this.file, maximumScriptBytes);
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
      const installed = value?.bytes.equals(Buffer.from(this.script)) ?? false;
      const executable = installed && !!(value!.mode & 0o100);
      return {
        path: this.file,
        installed,
        executable,
        problem:
          value && !installed
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
      if (!existing.bytes.equals(Buffer.from(this.script)))
        throw new Error(
          'The existing command at ~/.local/bin/viewer was preserved. Inspect that file before retrying installation.',
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
    if (!before.bytes.equals(Buffer.from(this.script)))
      throw new Error(
        'The existing command was preserved because it is not this Viewer installation.',
      );
    if (!(await this.confirm(this.file))) return this.status();
    const after = await this.inspect();
    if (!after || !sameReviewedFile(after.reviewed, before.reviewed))
      throw new Error('The command changed after confirmation. It was preserved.');
    await this.trash(before.reviewed);
    return this.status();
  }
}
