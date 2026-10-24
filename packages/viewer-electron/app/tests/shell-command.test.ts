import { readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellCommand } from '../src/desktop/shell-command';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const roots: string[] = [];
async function home(): Promise<string> {
  const root = await temporaryRoot('viewer-shell-');
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await trashTemporary(root);
});

describe('shell command installation', () => {
  it('installs exclusively, quotes the executable, and requires confirmation before calling Trash', async () => {
    const root = await home();
    const trash = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    const command = new ShellCommand(root, "/Applications/Viewer's app/Viewer", trash, confirm);
    expect((await command.status()).installed).toBe(false);
    expect((await command.install()).installed).toBe(true);
    const script = await readFile(command.file, 'utf8');
    expect(script).toContain("exec '/Applications/Viewer'\\''s app/Viewer' \"$@\"");
    expect((await stat(command.file)).mode & 0o777).toBe(0o755);
    await command.uninstall();
    expect(confirm).toHaveBeenCalledWith(command.file);
    expect(trash).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await command.uninstall();
    expect(trash).toHaveBeenCalledExactlyOnceWith(command.file);
    // This fake Trash records the approved scope while every fixture remains on disk.
    expect(await readFile(command.file, 'utf8')).toBe(script);
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
});
