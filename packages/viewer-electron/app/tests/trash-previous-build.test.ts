/**
 * A rebuild trashes the previous build: Forge deletes `.vite` and its output folder before
 * writing new ones. After helper preparation succeeds, packaging moves exactly those two to the
 * Trash and stops if the Trash fails.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { localBuild, trashPreviousBuild } from '../tools/trash-previous-build';
import { packageBuild, requireNewPackage } from '../tools/package-build';
import manifest from '../package.json' with { type: 'json' };
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, trash: string;
const dependency = (name: string) => path.join(root, 'node_modules', name);
const ptyFile = () => dependency('node-pty/src/unix/pty.cc');
beforeEach(async () => {
  root = await temporaryRoot('viewer-rebuild-');
  trash = path.join(root, 'trash');
  await mkdir(trash);
  for (const [name, metadata] of [
    ['pdfjs-dist', {}],
    ['@napi-rs/canvas', { optionalDependencies: { 'canvas-target': '1' } }],
    ['canvas-target', { os: ['darwin'], cpu: ['arm64'], main: 'skia.node' }],
    ['node-pty', {}],
    ['node-addon-api', {}],
  ] as const) {
    await mkdir(dependency(name), { recursive: true });
    await writeFile(dependency(name + '/package.json'), JSON.stringify({ name, ...metadata }));
  }
  await writeFile(dependency('canvas-target/skia.node'), '');
  await mkdir(path.dirname(ptyFile()), { recursive: true });
  await writeFile(ptyFile(), 'tcsetattr(slave, TCSANOW, termp); ioctl(slave, TIOCSWINSZ, winp);');
});
afterEach(async () => {
  await trashTemporary(root);
});
const app = () => path.join(root, 'app');
const toTrash = async (file: string) => {
  await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
};
const build = async () => {
  await mkdir(path.join(app(), '.vite', 'build'), { recursive: true });
  await writeFile(path.join(app(), '.vite', 'build', 'main.js'), 'main');
  await mkdir(path.join(app(), 'out', 'Viewer-darwin-arm64', 'Viewer.app'), { recursive: true });
  await mkdir(path.join(app(), 'out', 'notes'), { recursive: true });
};

it.each(['make', 'package'] as const)(
  'validates forwarded targets and filters both %s children',
  async (command) => {
    expect(manifest.scripts[command]).toBe('tsx tools/trash-previous-build.ts ' + command);
    await mkdir(app());
    const child = vi.fn(async (_command: string, _args: string[], _env: NodeJS.ProcessEnv) => {});
    const move = vi.fn();
    const env = {
      VIEWER_BUILD_ARCH: 'arm64',
      PATH: 'fixture',
      VIEWER_LICENSE_SIGNING_KEY: 'dummy',
      VIEWER_LICENSE_SIGNING_KEY_FILE: 'dummy',
      VIEWER_UPDATE_SIGNING_KEY: 'dummy',
      VIEWER_UPDATE_SIGNING_KEY_FILE: 'dummy',
    };
    for (const args of [['--arch=x64'], ['-a', 'x64'], ['-ax64'], ['--platform', 'mas']]) {
      await expect(
        localBuild(app(), [command, ...args], 'darwin', 'arm64', env, child, move),
      ).rejects.toThrow();
    }
    expect(move).not.toHaveBeenCalled();
    expect(child).not.toHaveBeenCalled();
    await localBuild(app(), [command, '--arch=arm64'], 'darwin', 'arm64', env, child, move);
    expect(child.mock.calls.map(([file]) => file)).toEqual(['tsx', 'electron-forge']);
    expect(child.mock.calls[1]?.[1]).toContain('--arch=arm64');
    for (const [, , environment] of child.mock.calls) {
      expect(environment.PATH).toBe('fixture');
      expect(Object.keys(environment).some((name) => name.includes('SIGNING_KEY'))).toBe(false);
    }
  },
);

it.each(['make', 'package'])(
  'keeps the previous build when %s helper preparation fails',
  async (command) => {
    await build();
    const child = vi.fn(async () => {
      throw new Error('Helper preparation failed');
    });
    const move = vi.fn(toTrash);
    await expect(localBuild(app(), [command], 'darwin', 'arm64', {}, child, move)).rejects.toThrow(
      'Helper preparation failed',
    );
    expect(move).not.toHaveBeenCalled();
    expect(child).toHaveBeenCalledExactlyOnceWith(
      'tsx',
      ['tools/build-helpers.ts'],
      expect.objectContaining({ VIEWER_PACKAGE_RUN: '1' }),
    );
    expect(await readFile(path.join(app(), '.vite/build/main.js'), 'utf8')).toBe('main');
    expect(
      (await lstat(path.join(app(), 'out/Viewer-darwin-arm64/Viewer.app'))).isDirectory(),
    ).toBe(true);
  },
);

it('checks make output again before Trash after the helpers finish', async () => {
  await build();
  const child = vi.fn(async (tool: string) => {
    if (tool === 'tsx') {
      const results = path.join(app(), 'out/make-results');
      await mkdir(results);
      await writeFile(path.join(results, 'previous.forge-make.json'), '{}', { flag: 'wx' });
    }
  });
  const move = vi.fn(toTrash);
  await expect(localBuild(app(), ['make'], 'darwin', 'arm64', {}, child, move)).rejects.toThrow(
    'preserve',
  );
  expect(move).not.toHaveBeenCalled();
  expect(child).toHaveBeenCalledOnce();
});

it.each([
  ['zip,viewer-missing-maker', 'viewer-missing-maker'],
  ['./local-maker.mjs', 'darwin'],
  ['./incomplete-maker.mjs', 'maker'],
  ['zip,./incomplete-maker.mjs', 'interface'],
  ['zip,', 'maker'],
])('keeps the previous build when make cannot use %s', async (targets, reason) => {
  await build();
  await writeFile(
    path.join(app(), 'local-maker.mjs'),
    `
    export default class LocalMaker {
      platforms = ['win32'];
      isSupportedOnCurrentPlatform() { return true; }
      ensureExternalBinariesExist() {}
    }
  `,
  );
  await writeFile(
    path.join(app(), 'incomplete-maker.mjs'),
    `
    export default class IncompleteMaker {
      platforms = ['darwin'];
      isSupportedOnCurrentPlatform() { return true; }
      ensureExternalBinariesExist() {}
    }
  `,
  );
  const move = vi.fn(toTrash);
  const child = vi.fn();
  await expect(
    localBuild(app(), ['make', '--targets', targets], 'darwin', 'arm64', {}, child, move),
  ).rejects.toThrow(reason);
  expect(move).not.toHaveBeenCalled();
  expect(child.mock.calls.some(([tool]) => tool === 'electron-forge')).toBe(false);
  expect(await readFile(path.join(app(), '.vite/build/main.js'), 'utf8')).toBe('main');
  expect((await lstat(path.join(app(), 'out/Viewer-darwin-arm64/Viewer.app'))).isDirectory()).toBe(
    true,
  );
});

it.each(['zip,./windows.mjs', './windows.mjs,zip'])(
  'uses the macOS maker in the mixed target list %s',
  async (targets) => {
    await build();
    await writeFile(
      path.join(app(), 'windows.mjs'),
      `export default class WindowsMaker {
        platforms = ['win32'];
        isSupportedOnCurrentPlatform() { throw new Error('Windows-only check'); }
      }`,
    );
    const child = vi.fn();
    const move = vi.fn(toTrash);
    await localBuild(app(), ['make', '--targets', targets], 'darwin', 'arm64', {}, child, move);
    expect(child).toHaveBeenLastCalledWith('electron-forge', ['make', '--targets', targets], expect.any(Object));
    expect(move).toHaveBeenCalledTimes(2);
  },
);

it('accepts a configured maker, an installed maker and a custom make target', async () => {
  await build();
  const installed = createRequire(import.meta.url).resolve('@electron-forge/maker-zip');
  await writeFile(
    path.join(app(), 'local-maker.mjs'),
    `
    import { writeFileSync } from 'node:fs';
    import MakerZIP from ${JSON.stringify(pathToFileURL(installed).href)};
    export default class LocalMaker extends MakerZIP {
      ensureExternalBinariesExist() {
        writeFileSync('maker-check.json', JSON.stringify(Object.keys(process.env).filter(key => key.includes('SIGNING_KEY'))));
      }
    }
  `,
  );
  const targets = 'zip,@electron-forge/maker-zip,./local-maker.mjs';
  const child = vi.fn();
  const move = vi.fn(toTrash);
  await localBuild(
    app(),
    ['make', '--targets=' + targets],
    'darwin',
    'arm64',
    { VIEWER_UPDATE_SIGNING_KEY: 'fixture' },
    child,
    move,
  );
  expect(await readFile(path.join(app(), 'maker-check.json'), 'utf8')).toBe('[]');
  expect(move).toHaveBeenCalledTimes(2);
  expect(child).toHaveBeenLastCalledWith(
    'electron-forge',
    ['make', '--targets=' + targets],
    expect.any(Object),
  );
});

it.each([
  ['canvas target', /canvas native dependency/],
  ['canvas binary', /missing\.node/],
  ['pty source', /node-pty sandbox compatibility/],
] as const)('preserves both destinations with an incompatible %s', async (input, message) => {
  await build();
  if (input === 'canvas target')
    await writeFile(
      dependency('canvas-target/package.json'),
      JSON.stringify({ os: ['darwin'], cpu: ['x64'] }),
    );
  else if (input === 'canvas binary')
    await writeFile(
      dependency('canvas-target/package.json'),
      JSON.stringify({ os: ['darwin'], cpu: ['arm64'], main: 'missing.node' }),
    );
  else await writeFile(ptyFile(), 'tcsetattr(slave, TCSANOW, termp);');
  const move = vi.fn(toTrash);
  const child = vi.fn();
  await expect(localBuild(app(), ['package'], 'darwin', 'arm64', {}, child, move)).rejects.toThrow(
    message,
  );
  expect(move).not.toHaveBeenCalled();
  expect(child.mock.calls.some(([tool]) => tool === 'electron-forge')).toBe(false);
  expect(await readFile(path.join(app(), '.vite/build/main.js'), 'utf8')).toBe('main');
  expect((await lstat(path.join(app(), 'out/Viewer-darwin-arm64/Viewer.app'))).isDirectory()).toBe(
    true,
  );
});

it.each(['make', 'package'])(
  'rejects an invalid direct identity before %s moves either destination',
  async (command) => {
    await build();
    const move = vi.fn(toTrash);
    const child = vi.fn();
    await expect(
      localBuild(app(), [command], 'darwin', 'arm64', { VIEWER_DIRECT_IDENTITY: '-' }, child, move),
    ).rejects.toThrow('Developer ID Application');
    expect(move).not.toHaveBeenCalled();
    expect(child).not.toHaveBeenCalled();
  },
);

it.each(['linux', 'win32'])('requires one concrete package target on %s', async (platform) => {
  const directory = path.join(app(), 'out', 'Viewer-' + platform + '-x64');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'sentinel'), 'retained');
  const child = vi.fn();
  const trash = vi.fn();
  for (const arch of ['all', 'x64,arm64', '']) {
    for (const args of [['package'], ['make'], ['make', '--from-package']]) {
      await expect(
        localBuild(app(), [...args, '--arch=' + arch], platform, 'x64', {}, child, trash),
      ).rejects.toThrow(/one concrete architecture/i);
    }
    await expect(requireNewPackage(app(), platform, arch)).rejects.toThrow(
      /one concrete architecture/i,
    );
  }
  expect(child).not.toHaveBeenCalled();
  expect(trash).not.toHaveBeenCalled();
  expect(await readFile(path.join(directory, 'sentinel'), 'utf8')).toBe('retained');
});

it.each(['.vite', 'out/Viewer-mas-arm64'])(
  'refuses retained Store output before invoking a child (%s)',
  async (relative) => {
    const target = path.join(app(), relative);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'sentinel'), 'original');
    const child = vi.fn();
    await expect(packageBuild(app(), 'mas', 'arm64', child)).rejects.toThrow(/preserve/i);
    expect(child).not.toHaveBeenCalled();
    expect(await readFile(path.join(target, 'sentinel'), 'utf8')).toBe('original');
  },
);

it('holds make ownership through publication of the ZIP and result manifest', async () => {
  await mkdir(app());
  let publish!: () => void;
  const release = new Promise<void>((resolve) => {
    publish = resolve;
  });
  let makers = 0;
  const child = async (file: string) => {
    if (file === 'tsx') return;
    makers++;
    await release;
    for (const relative of ['make/zip/viewer.zip', 'make-results/first.json']) {
      const output = path.join(app(), 'out', relative);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, 'first', { flag: 'wx' });
    }
  };
  const start = () => localBuild(app(), ['make'], 'darwin', 'arm64', {}, child, vi.fn());
  const first = start();
  await vi.waitFor(() => expect(makers).toBe(1));
  try {
    await expect(start()).rejects.toThrow(/build/i);
  } finally {
    publish();
    await first;
  }
  await expect(start()).rejects.toThrow(/preserve/i);
  expect(makers).toBe(1);
  expect(await readFile(path.join(app(), 'out/make-results/first.json'), 'utf8')).toBe('first');
});

it('allows an empty hierarchy after the ZIP and manifests were preserved', async () => {
  await mkdir(path.join(app(), 'out/make/zip/darwin/arm64'), { recursive: true });
  await expect(
    trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', make: true, trash: vi.fn() }),
  ).resolves.toEqual([]);
});

it('refuses an empty directory occupying a ZIP destination', async () => {
  const directory = path.join(app(), 'out/make/zip/darwin/arm64/Viewer.zip');
  await mkdir(directory, { recursive: true });
  const move = vi.fn();
  await expect(
    trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', make: true, trash: move }),
  ).rejects.toThrow(/preserve/);
  expect(move).not.toHaveBeenCalled();
  expect((await lstat(directory)).isDirectory()).toBe(true);
});

it.each(['make', 'package'])(
  'preserves the previous build when the %s Forge entry is missing',
  async (command) => {
    await build();
    await mkdir(dependency('@electron-forge/cli'), { recursive: true });
    await writeFile(
      dependency('@electron-forge/cli/package.json'),
      JSON.stringify({ bin: { 'electron-forge': 'missing.cjs' } }),
    );
    await mkdir(dependency('tsx'));
    await writeFile(dependency('tsx/cli.js'), '');
    const move = vi.fn(async () => {
      throw new Error('Unexpected Trash request');
    });
    await expect(
      localBuild(app(), [command], 'darwin', 'arm64', {}, undefined, move),
    ).rejects.toThrow(/missing\.cjs/);
    expect(move).not.toHaveBeenCalled();
    expect(await readFile(path.join(app(), '.vite/build/main.js'), 'utf8')).toBe('main');
    expect(
      (await lstat(path.join(app(), 'out/Viewer-darwin-arm64/Viewer.app'))).isDirectory(),
    ).toBe(true);
  },
);

it.each(['make', 'package'])(
  'runs both %s child entry points with publisher variables removed',
  async (command) => {
    const modules = path.join(app(), 'node_modules');
    const forge = path.join(modules, '@electron-forge/cli');
    await mkdir(forge, { recursive: true });
    await mkdir(path.join(modules, 'tsx'));
    await writeFile(
      path.join(forge, 'package.json'),
      JSON.stringify({ bin: { 'electron-forge': 'fixture.cjs' } }),
    );
    const record =
      'require("node:fs").appendFileSync("calls.jsonl", JSON.stringify({args:process.argv.slice(2), keys:Object.keys(process.env).filter(k=>k.includes("SIGNING_KEY"))})+"\\n")';
    await writeFile(path.join(forge, 'fixture.cjs'), record);
    await writeFile(path.join(modules, 'tsx/cli.js'), record);
    await localBuild(app(), [command, '-a', 'arm64'], 'darwin', 'arm64', {
      VIEWER_LICENSE_SIGNING_KEY: 'dummy',
      VIEWER_UPDATE_SIGNING_KEY_FILE: 'dummy',
    });
    const lines = (await readFile(path.join(app(), 'calls.jsonl'), 'utf8')).trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { args: ['tools/build-helpers.ts'], keys: [] },
      { args: [command, '-a', 'arm64'], keys: [] },
    ]);
  },
);

it('moves the previous build to the Trash, and nothing else', async () => {
  await build();
  const moved = await trashPreviousBuild(app(), {
    platform: 'darwin',
    arch: 'arm64',
    trash: toTrash,
  });
  expect(moved).toEqual([
    path.join(app(), '.vite'),
    path.join(app(), 'out', 'Viewer-darwin-arm64'),
  ]);
  expect((await readdir(trash)).length).toBe(2);
  // other output stays, and the folders a build recreates are gone
  expect(await readdir(path.join(app(), 'out'))).toEqual(['notes']);
  await expect(lstat(path.join(app(), '.vite'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('does nothing when there is no previous build', async () => {
  await mkdir(app());
  expect(
    await trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', trash: toTrash }),
  ).toEqual([]);
});
it('refuses a link in place of a build folder, and moves nothing', async () => {
  await mkdir(path.join(root, 'elsewhere'), { recursive: true });
  await mkdir(app());
  await symlink(path.join(root, 'elsewhere'), path.join(app(), '.vite'));
  await expect(
    trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', trash: toTrash }),
  ).rejects.toThrow('link');
  expect(await readdir(trash)).toEqual([]);
});
it('stops when the Trash fails, deleting nothing', async () => {
  await build();
  await expect(
    trashPreviousBuild(app(), {
      platform: 'darwin',
      arch: 'arm64',
      trash: async () => {
        throw new Error('Trash unavailable');
      },
    }),
  ).rejects.toThrow('Trash unavailable');
  expect((await lstat(path.join(app(), '.vite'))).isDirectory()).toBe(true);
  expect((await lstat(path.join(app(), 'out', 'Viewer-darwin-arm64'))).isDirectory()).toBe(true);
});

it.each(['universal', '../arm64'])(
  'refuses unsupported architecture %s before Trash',
  async (arch) => {
    await build();
    const move = vi.fn();
    await expect(
      trashPreviousBuild(app(), { platform: 'darwin', arch, trash: move }),
    ).rejects.toThrow('macOS build architectures');
    expect(move).not.toHaveBeenCalled();
  },
);

it('refuses an out symlink before moving either target', async () => {
  await mkdir(path.join(app(), '.vite'), { recursive: true });
  await mkdir(path.join(root, 'elsewhere', 'Viewer-darwin-arm64'), { recursive: true });
  await symlink(path.join(root, 'elsewhere'), path.join(app(), 'out'));
  const move = vi.fn();
  await expect(
    trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', trash: move }),
  ).rejects.toThrow('out');
  expect(move).not.toHaveBeenCalled();
});

it.each(['make/zip/darwin/arm64/Viewer.zip', 'make-results/previous.forge-make.json'])(
  'leaves prior make output in place (%s)',
  async (relative) => {
    await build();
    const previous = path.join(app(), 'out', relative);
    await mkdir(path.dirname(previous), { recursive: true });
    await writeFile(previous, 'retained fixture', { flag: 'wx' });
    const move = vi.fn();
    await expect(
      trashPreviousBuild(app(), {
        platform: 'darwin',
        arch: 'arm64',
        trash: move,
        make: true,
      }),
    ).rejects.toThrow('preserve');
    expect(move).not.toHaveBeenCalled();
    expect((await lstat(previous)).isFile()).toBe(true);
  },
);
