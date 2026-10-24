import { chmod, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellCommand, type ReviewedFile } from '../src/desktop/windows/shell-command';
import * as reviewedFiles from '../src/desktop/native/reviewed-file';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const roots: string[] = [];
async function home(): Promise<string> {
  const root = await temporaryRoot('viewer-shell-');
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await trashTemporary(root);
});

describe('shell command installation', () => {
  it('installs exclusively and passes the exact reviewed version to the Trash operation', async () => {
    const root = await home();
    const trash = vi.fn(async (reviewed: ReviewedFile) => {
      await reviewedFiles.verifyReviewedFile(reviewed);
    });
    const confirm = vi.fn(async () => false);
    const command = new ShellCommand(root, "/Applications/Viewer's app/Viewer", trash, confirm);
    expect((await command.status()).installed).toBe(false);
    expect(await command.install()).toMatchObject({ installed: true, executable: true });
    const script = await readFile(command.file, 'utf8');
    expect(script).toContain("exec '/Applications/Viewer'\\''s app/Viewer' \"$@\"");
    const info = await stat(command.file);
    expect(info.mode & 0o777).toBe(0o755);
    await command.uninstall();
    expect(confirm).toHaveBeenCalledWith(command.file);
    expect(trash).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await command.uninstall();
    expect(trash).toHaveBeenCalledExactlyOnceWith({
      path: command.file,
      version: { identity: `${info.dev}:${info.ino}`, modified: info.mtimeMs, size: info.size },
      sha256: createHash('sha256').update(script).digest('hex'),
    });
    // The recording Trash validates the approved scope while preserving the actual fixture.
    expect(await readFile(command.file, 'utf8')).toBe(script);
  });

  it('executes the generated script with literal arguments and the caller’s working directory', async () => {
    const root = await home();
    const executable = path.join(root, "Viewer's generated executable");
    await writeFile(
      executable,
      `#!${process.execPath}\n` +
        'process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n',
      { mode: 0o755 },
    );
    const command = new ShellCommand(
      root,
      executable,
      async () => {},
      async () => false,
    );
    await command.install();
    const args = ['two words', '$(literal argument)', '--workspace', 'Research', '--', '--file'];
    const output = await promisify(execFile)(command.file, args, { cwd: root });
    expect(JSON.parse(output.stdout)).toEqual({ args, cwd: await realpath(root) });
  });

  it('preserves a command changed during confirmation and refuses linked parent folders', async () => {
    const root = await home();
    const trash = vi.fn(async () => {});
    const command = new ShellCommand(root, '/Viewer', trash, async () => {
      await writeFile(command.file, '# Another installation\n');
      return true;
    });
    await command.install();
    await expect(command.uninstall()).rejects.toThrow('changed after confirmation');
    expect(trash).not.toHaveBeenCalled();
    await expect(command.install()).rejects.toThrow('preserved');
    const linkedHome = await home();
    await symlink(path.join(root, '.local'), path.join(linkedHome, '.local'));
    const linked = new ShellCommand(linkedHome, '/Viewer', trash, async () => true);
    await expect(linked.install()).rejects.toThrow();
  });

  it('keeps the review when the path changes after its last inspection closes', async () => {
    const root = await home();
    const recordTrash = vi.fn();
    const command = new ShellCommand(
      root,
      '/Viewer',
      async (reviewed) => {
        // The production adapter performs this check inside its native delete claim.
        await reviewedFiles.verifyReviewedFile(reviewed);
        recordTrash(reviewed);
      },
      async () => true,
    );
    await command.install();
    const inspect = reviewedFiles.inspectReviewedFile;
    let inspected = 0;
    vi.spyOn(reviewedFiles, 'inspectReviewedFile').mockImplementation(async (...args) => {
      const result = await inspect(...args);
      if (++inspected === 2) await writeFile(command.file, '# Foreign replacement after close\n');
      return result;
    });
    await expect(command.uninstall()).rejects.toThrow('changed after confirmation');
    expect(recordTrash).not.toHaveBeenCalled();
    expect(await readFile(command.file, 'utf8')).toBe('# Foreign replacement after close\n');
  });

  it('reports a matching script without owner execute permission honestly and permits uninstall', async () => {
    const root = await home();
    const trash = vi.fn(async () => {});
    const command = new ShellCommand(root, '/Viewer', trash, async () => true);
    await command.install();
    await chmod(command.file, 0o600);
    expect(await command.status()).toMatchObject({ installed: true, executable: false });
    await command.uninstall();
    expect(trash).toHaveBeenCalledOnce();
    expect(await readFile(command.file, 'utf8')).toContain('Viewer shell command v1');
  });

  it('preserves the script if the operating system Trash rejects the operation', async () => {
    const root = await home();
    const command = new ShellCommand(
      root,
      '/Viewer',
      async () => {
        throw new Error('Trash unavailable');
      },
      async () => true,
    );
    await command.install();
    const before = await readFile(command.file);
    await expect(command.uninstall()).rejects.toThrow('Trash unavailable');
    expect(await readFile(command.file)).toEqual(before);
  });
});
