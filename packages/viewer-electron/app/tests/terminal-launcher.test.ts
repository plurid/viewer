import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ExternalTerminals,
  launcherScript,
  shellQuote,
} from '../src/desktop/terminals/terminal-launch';
import type { Launcher } from '../src/desktop/terminals/terminal-launch';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const exec = promisify(execFile);
let root: string;
beforeEach(async () => {
  root = await fs.realpath(await temporaryRoot('viewer-terminal-launcher-'));
});
afterEach(async () => {
  await trashTemporary(root);
});
const launcher = (folder: string, name = randomUUID() + '.command'): Launcher => ({
  file: path.join(folder, name),
  folder,
  cwd: path.join(root, "Project ' $(uname)"),
  env: { TOKEN: "it's secret" },
  executable: '/bin/zsh',
  args: ['-l'],
});

describe('terminal launcher scripts (2026-10-30)', () => {
  // The launcher ran `/bin/rm` on its path with no check of what that path then was.
  it('removes exactly its own file, and only when it is the file Viewer wrote', () => {
    const folder = "/Users/person/Library/Application Support/Viewer's data/terminal-launches";
    const value = launcher(folder, '0a1b2c3d-0000-4000-8000-00000000000f.command');
    const file = shellQuote(value.file);
    const launches = shellQuote(folder);
    expect(file).toBe(
      "'/Users/person/Library/Application Support/Viewer'\\''s data/terminal-launches/" +
        "0a1b2c3d-0000-4000-8000-00000000000f.command'",
    );
    expect(launcherScript(value).split('\n')).toEqual([
      '#!/bin/zsh',
      `if [[ \${0:A} == ${file} ]] &&`,
      `  [[ ! -L ${file} && -f ${file} && -O ${file} && -w ${file} ]] &&`,
      `  [[ ! -L ${launches} && -d ${launches} && -O ${launches} ]] &&`,
      `  [[ $(/usr/bin/stat -f %Lp -- ${launches}) == 700 ]]`,
      'then',
      `  /bin/rm -- ${file}`,
      'fi',
      `cd -- ${shellQuote(value.cwd)} || exit`,
      `exec /usr/bin/env TOKEN='it'\\''s secret' '/bin/zsh' '-l'`,
      '',
    ]);
    const removals = launcherScript(value)
      .split('\n')
      .filter((line) => /\brm\b/.test(line));
    expect(removals).toEqual([`  /bin/rm -- ${file}`]);
  });
  it('is only written directly inside the launch folder, under its random name', () => {
    const folder = path.join(root, 'launches');
    expect(() =>
      launcherScript({ ...launcher(folder), file: path.join(root, randomUUID() + '.command') }),
    ).toThrow('directly inside');
    expect(() => launcherScript(launcher(folder, 'notes.command'))).toThrow('directly inside');
  });
  it('parses in zsh, and still opens the shell where it cannot remove itself', async () => {
    const folder = path.join(root, 'launches');
    await fs.mkdir(folder, { mode: 0o700 });
    const cwd = path.join(root, "Project ' $(uname)");
    await fs.mkdir(cwd);
    // its own path does not exist: run from elsewhere, the guard holds and nothing is removed
    const value = { ...launcher(folder), executable: '/usr/bin/touch', args: ['opened'] };
    const copy = path.join(root, 'copy.command');
    await fs.writeFile(copy, launcherScript(value), { mode: 0o700 });
    await exec('/bin/zsh', ['-n', copy]);
    // an empty ZDOTDIR keeps the person's own zsh startup files out of the run
    const home = path.join(root, 'zsh');
    await fs.mkdir(home);
    await exec(copy, [], { env: { PATH: '/usr/bin:/bin', ZDOTDIR: home } });
    await expect(fs.stat(path.join(cwd, 'opened'))).resolves.toBeTruthy();
    expect(await fs.readFile(copy, 'utf8')).toBe(launcherScript(value));
  });
});

describe('the private launch folder (2026-10-30)', () => {
  const config = defaultSettings('/');
  const apps = [{ name: 'Terminal', path: '/Applications/Terminal.app', running: false }];
  it('writes each launcher into a real folder of this user’s, mode 0700, by its resolved path', async () => {
    const folder = path.join(root, 'launches');
    await fs.mkdir(folder, { mode: 0o755 });
    await fs.chmod(folder, 0o755);
    const alias = path.join(root, 'alias');
    await fs.symlink(root, alias);
    const open = vi.fn(async (_app: string, _file: string) => {});
    const terminals = new ExternalTerminals(path.join(alias, 'launches'), () => config, '', {
      discover: async () => apps,
      run: vi.fn(),
      open,
    });
    await terminals.open(root);
    const script = open.mock.calls[0][1];
    expect(path.dirname(script)).toBe(folder);
    expect((await fs.stat(folder)).mode & 0o777).toBe(0o700);
    expect(await fs.readFile(script, 'utf8')).toContain(`  /bin/rm -- ${shellQuote(script)}\n`);
  });
  it('opens no terminal through a launch folder that is a link', async () => {
    const elsewhere = path.join(root, 'elsewhere');
    await fs.mkdir(elsewhere, { mode: 0o700 });
    const folder = path.join(root, 'launches');
    await fs.symlink(elsewhere, folder);
    const open = vi.fn(async (_app: string, _file: string) => {});
    const terminals = new ExternalTerminals(folder, () => config, '', {
      discover: async () => apps,
      run: vi.fn(),
      open,
    });
    await expect(terminals.open(root)).rejects.toThrow(
      `Viewer’s terminal launch folder, ${folder}, is a link or another user’s`,
    );
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });
});
