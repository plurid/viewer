import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clipboard } from 'electron';
import type { ClipboardItem } from 'electron';
import type * as FileSystem from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { chmod, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileAccess, FileAccessRequired } from '../src/desktop/files/file-access';
import { NativeSelections } from '../src/desktop/native/native-selections';
import { Pasteboard } from '../src/desktop/native/pasteboard';
import { Operations } from '../src/desktop/operations/operations';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import { SettingsService } from '../src/desktop/preferences/settings';
import { OperationLog } from '../src/desktop/operations/operation-journal';
import { createPasteboardHandlers } from '../src/desktop/ipc/pasteboard-handlers';
import { MAX_CLIPBOARD_IMAGE_BYTES, checkClipboardImageSize } from '../src/domain/files/clipboard';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type { FileAccessIntent } from '../src/desktop/native/macos-files';
import { copyBrowserPaths } from './browser-clipboard';

const imageIO = vi.hoisted(() => ({
  write: undefined as ((file: FileHandle, bytes: Uint8Array) => Promise<void>) | undefined,
  sync: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const output = await actual.open(...args);
      const file = String(args[0]);
      if (!file.includes('.viewer-image-') && !file.endsWith('Pasted image.png')) return output;
      return new Proxy(output, {
        get(target, key) {
          if (key === 'writeFile' && imageIO.write)
            return (bytes: Uint8Array) => imageIO.write!(target, bytes);
          if (key === 'sync' && imageIO.sync) return imageIO.sync;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

const native = vi.hoisted(() => ({
  clipboardRead: vi.fn(() => ({
    files: [] as { path: string; directory: boolean; bookmark?: string }[],
    changeCount: 7,
  })),
  clipboardWrite: vi.fn(() => 7),
  clipboardVersion: vi.fn(() => 7),
  coordinateStart: vi.fn(async (_id: string, intents: FileAccessIntent[]) =>
    intents.map((intent) => intent.path),
  ),
  coordinateEnd: vi.fn(async () => {}),
  coordinateCancel: vi.fn(),
  coordinateSameItem: vi.fn(() => true),
  renameExclusive: vi.fn(async (source: string, destination: string) => {
    const occupied = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (occupied) throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
    await rename(source, destination);
  }),
}));
vi.mock('../src/desktop/native/macos-files', () => ({ macFiles: () => native }));
vi.mock('electron', () => ({
  clipboard: {
    has: vi.fn(async () => true),
    read: vi.fn(async () => []),
    readText: vi.fn(() => ''),
    writeText: vi.fn(),
  },
}));
afterEach(() => vi.restoreAllMocks());

describe('desktop pasteboard', () => {
  it('keeps copied files ahead of their preview picture without reading the picture', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const selection = {
      files: [{ path: '/fixtures/picture.png', directory: false }],
      changeCount: 7,
    };
    native.clipboardRead.mockReturnValueOnce(selection).mockReturnValueOnce(selection);
    const pasteboard = new Pasteboard(
      new FileAccess('/fixtures/profile'),
      new NativeSelections(() => 7),
    );
    await expect(pasteboard.read()).resolves.toEqual({
      paths: ['/fixtures/picture.png'],
      cut: false,
    });
    await expect(pasteboard.readForPaste()).resolves.toEqual({
      paths: ['/fixtures/picture.png'],
      cut: false,
    });
    expect(clipboard.has).not.toHaveBeenCalled();
    expect(clipboard.read).not.toHaveBeenCalled();
  });
  it('offers a picture without encoding it during clipboard discovery', async () => {
    const pasteboard = new Pasteboard(
      new FileAccess('/fixtures/profile'),
      new NativeSelections(() => 7),
    );
    await expect(pasteboard.read()).resolves.toEqual({ paths: [], cut: false, image: true });
    expect(clipboard.has).toHaveBeenCalledExactlyOnceWith('image/png');
    expect(clipboard.read).not.toHaveBeenCalled();
  });
  it.each(['win32', 'linux'] as const)(
    'does not discover or paste pictures on %s without native files-first support',
    async (platform) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
      const pasteboard = new Pasteboard(
        new FileAccess('/fixtures/profile'),
        new NativeSelections(() => 7),
      );
      await expect(pasteboard.read()).resolves.toBeNull();
      await expect(pasteboard.readForPaste()).resolves.toBeNull();
      expect(clipboard.has).not.toHaveBeenCalled();
      expect(clipboard.read).not.toHaveBeenCalled();
      expect(native.clipboardRead).not.toHaveBeenCalled();
      await pasteboard.write(['/fixtures/copied.png'], false);
      vi.mocked(clipboard.readText).mockResolvedValueOnce('/fixtures/copied.png');
      await expect(pasteboard.readForPaste()).resolves.toEqual({
        paths: ['/fixtures/copied.png'],
        cut: false,
      });
    },
  );
  it.each(['text', 'empty'])('leaves the %s-only clipboard unchanged', async (kind) => {
    vi.mocked(clipboard.has).mockResolvedValueOnce(false);
    vi.mocked(clipboard.read).mockResolvedValueOnce(
      kind === 'text'
        ? [
            {
              types: ['text/plain'],
              getType: vi.fn(async () => new Blob(['note'])),
            } as unknown as ClipboardItem,
          ]
        : [],
    );
    const pasteboard = new Pasteboard(
      new FileAccess('/fixtures/profile'),
      new NativeSelections(() => 7),
    );
    await expect(pasteboard.read()).resolves.toBeNull();
    await expect(pasteboard.readForPaste()).resolves.toBeNull();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it('keeps the cut flag only while the native copied files are current', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const pasteboard = new Pasteboard(
      new FileAccess('/fixtures/profile'),
      new NativeSelections(() => 7),
    );
    await pasteboard.write(['/fixtures/picture.png'], true);
    for (const changeCount of [7, 8]) {
      native.clipboardRead.mockReturnValueOnce({
        files: [{ path: '/fixtures/picture.png', directory: false }],
        changeCount,
      });
      await expect(pasteboard.readForPaste()).resolves.toEqual({
        paths: ['/fixtures/picture.png'],
        cut: changeCount === 7,
      });
    }
    expect(clipboard.read).not.toHaveBeenCalled();
  });
  it('refuses inaccessible files without falling back to their preview image', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const access = new FileAccess('/fixtures/profile');
    vi.spyOn(access, 'require').mockRejectedValue(new FileAccessRequired('/fixtures'));
    native.clipboardRead.mockReturnValueOnce({
      files: [{ path: '/fixtures/picture.png', directory: false }],
      changeCount: 7,
    });
    const pasteboard = new Pasteboard(access, new NativeSelections(() => 7));
    await expect(pasteboard.readForPaste()).rejects.toThrow('Allow access to this folder');
    expect(clipboard.read).not.toHaveBeenCalled();
  });
});

describe('pasting clipboard pictures', () => {
  let root: string;
  let destination: string;
  let operations: Operations;
  let pasteboard: Pasteboard;
  const trash = vi.fn(async (_file: string) => {});
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=',
    'base64',
  );
  beforeEach(async () => {
    imageIO.write = undefined;
    imageIO.sync = undefined;
    root = await temporaryRoot('viewer-clipboard-');
    destination = path.join(root, 'destination');
    await mkdir(destination);
    operations = new Operations(trash, () => {}, undefined, undefined, undefined, root);
    pasteboard = new Pasteboard(new FileAccess(root), new NativeSelections(() => 7));
  });
  afterEach(async () => {
    await operations.close();
    await trashTemporary(root);
  });
  const handler = (isAgent = false) =>
    createPasteboardHandlers({
      pasteboard,
      operations,
      isAgent: () => isAgent,
      fileAccess: new FileAccess(root),
      window: () => undefined,
    }).clipboardPaste;
  const offerImage = (bytes = png) => {
    const getType = vi.fn(async () => new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
    vi.mocked(clipboard.read).mockResolvedValueOnce([
      { types: ['image/png'], getType } as unknown as ClipboardItem,
    ]);
    return getType;
  };
  const paste = async () => {
    offerImage();
    const result = await handler()([destination], 1);
    await operations.drained();
    const job = operations.all().find((job) => job.id === result?.id)!;
    expect(job.status).toBe('completed');
    return job;
  };
  const holdQueue = async () => {
    await mkdir(path.join(destination, 'held'));
    const id = operations.start({ kind: 'mkdir', sources: [], destination, name: 'held' });
    await vi.waitFor(() =>
      expect(operations.all().find((job) => job.id === id)?.status).toBe('collision'),
    );
    return id;
  };
  const retainedImage = (id: string) => {
    const tasks = Reflect.get(operations, 'tasks') as Map<string, { image?: Buffer }>;
    return tasks.get(id)?.image;
  };
  it('keeps a partial write in its recorded private stage and leaves the final name free', async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 1);
    imageIO.write = async (file, data) => {
      await file.writeFile(data.subarray(0, 1024 * 1024));
      throw new Error('No space left on device.');
    };
    const id = operations.createImage(destination, bytes);
    await operations.drained();
    const job = operations.all().find((job) => job.id === id)!;
    expect(job).toMatchObject({ status: 'failed', undoable: false, completed: [] });
    expect(job.errors[0]?.message).toBe('No space left on device.');
    await expect(lstat(path.join(destination, 'Pasted image.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(job.recovery?.staging).toContain('.viewer-image-');
    expect(await readFile(job.recovery!.staging!)).toEqual(bytes.subarray(0, 1024 * 1024));
    expect(job.errors.some((error) => error.path === path.dirname(job.recovery!.staging!))).toBe(
      true,
    );
    imageIO.write = undefined;
    expect((await paste()).completed[0]?.destination).toBe(
      path.join(destination, 'Pasted image.png'),
    );
  });
  it('recovers an interrupted picture write without publishing or replaying its partial stage', async () => {
    let writing: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      writing = resolve;
    });
    let finish: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      finish = resolve;
    });
    imageIO.write = async (file, bytes) => {
      await file.writeFile(bytes.subarray(0, 1024 * 1024));
      writing();
      await paused;
    };
    const id = operations.createImage(destination, Buffer.alloc(8 * 1024 * 1024, 1));
    await started;
    const restarted = new Operations(trash, () => {}, undefined, undefined, undefined, root);
    try {
      await restarted.load();
      const job = restarted.all().find((job) => job.id === id)!;
      expect(job).toMatchObject({ status: 'failed', undoable: false, completed: [] });
      expect(job.recovery?.staging).toContain('.viewer-image-');
      expect((await lstat(job.recovery!.staging!)).size).toBe(1024 * 1024);
      await expect(lstat(path.join(destination, 'Pasted image.png'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      operations.cancel(id);
      finish();
      await restarted.close();
    }
  });
  it('keeps a complete picture in its stage when syncing fails before publication', async () => {
    imageIO.sync = async () => {
      throw new Error('Picture sync failed.');
    };
    const id = operations.createImage(destination, png);
    await operations.drained();
    const job = operations.all().find((job) => job.id === id)!;
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toBe('Picture sync failed.');
    expect(job.completed).toEqual([]);
    await expect(lstat(path.join(destination, 'Pasted image.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(job.recovery!.staging!)).toEqual(png);
  });
  it('releases cancelled queued pictures immediately and bounds retained pictures to 128 MiB', async () => {
    await holdQueue();
    const bytes = Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES);
    const first = operations.createImage(destination, bytes);
    operations.createImage(destination, bytes);
    expect(() => operations.createImage(destination, png)).toThrow(
      'Wait for a picture paste to finish or cancel one before pasting another.',
    );
    operations.cancel(first);
    expect(operations.all().find((job) => job.id === first)?.status).toBe('cancelled');
    expect(retainedImage(first) === undefined).toBe(true);
    expect(() => operations.createImage(destination, bytes)).not.toThrow();
    expect(() => operations.createImage(destination, png)).toThrow(
      'Wait for a picture paste to finish or cancel one before pasting another.',
    );
    await operations.close();
    const saved = await new OperationLog(root).load();
    expect(saved.receipts.find((receipt) => receipt.job.id === first)?.job.status).toBe(
      'cancelled',
    );
  });
  it('releases picture bytes when a write fails', async () => {
    imageIO.write = async () => {
      throw new Error('Picture write failed.');
    };
    const id = operations.createImage(destination, png);
    await operations.drained();
    expect(operations.all().find((job) => job.id === id)?.status).toBe('failed');
    expect(retainedImage(id) === undefined).toBe(true);
  });
  it('keeps a queued picture cancellation receipt failure on that picture only', async () => {
    const running = await holdQueue();
    const cancelled = operations.createImage(destination, png);
    const record = OperationLog.prototype.record;
    const records = vi.spyOn(OperationLog.prototype, 'record').mockImplementation(function (
      this: OperationLog,
      receipt,
      durable,
    ) {
      if (receipt.job.id === cancelled)
        return Promise.reject(new Error('Cancellation receipt unavailable.'));
      return record.call(this, receipt, durable);
    });

    operations.cancel(cancelled);

    try {
      await vi.waitFor(() =>
        expect(operations.all().find((job) => job.id === cancelled)?.errors).toEqual([
          expect.objectContaining({
            message: expect.stringContaining('Cancellation receipt unavailable.'),
          }),
        ]),
      );
      expect(operations.all().find((job) => job.id === running)).toMatchObject({
        status: 'collision',
        errors: [],
      });
      expect(operations.all().find((job) => job.id === cancelled)?.status).toBe('cancelled');
      expect(records.mock.calls.map(([receipt]) => receipt.job.id)).toEqual([cancelled]);
    } finally {
      operations.resolve(running, 'skip', false);
    }
    await operations.drained();
    expect(operations.all().find((job) => job.id === running)?.status).toBe('completed');
  });
  it('releases picture bytes before announcing a failure that happened before writing', async () => {
    await operations.close();
    let heldAtFailure = false;
    operations = new Operations(
      trash,
      (job) => {
        if (job.status === 'failed') heldAtFailure = retainedImage(job.id) !== undefined;
      },
      undefined,
      undefined,
      async () => {
        throw new Error('Destination unavailable.');
      },
    );
    const id = operations.createImage(destination, png);
    await operations.drained();
    expect(operations.all().find((job) => job.id === id)?.status).toBe('failed');
    expect(heldAtFailure).toBe(false);
  });
  it('honours cancellation during a picture write and never publishes the staged bytes', async () => {
    let writing: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      writing = resolve;
    });
    let finish: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      finish = resolve;
    });
    imageIO.write = async (file, bytes) => {
      await file.writeFile(bytes.subarray(0, 1024 * 1024));
      writing();
      await paused;
      await file.writeFile(bytes.subarray(1024 * 1024));
    };
    const id = operations.createImage(destination, Buffer.alloc(8 * 1024 * 1024, 1));
    try {
      await started;
      operations.cancel(id);
      expect(retainedImage(id) === undefined).toBe(true);
    } finally {
      finish();
    }
    await operations.drained();
    const job = operations.all().find((job) => job.id === id)!;
    expect(job).toMatchObject({ status: 'cancelled', undoable: false, completed: [] });
    await expect(lstat(path.join(destination, 'Pasted image.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(job.recovery?.staging).toContain('.viewer-image-');
  });
  it('keeps a publication that wins the cancellation race completed and undoable', async () => {
    let id = '';
    native.renameExclusive.mockImplementationOnce(async (source, destination) => {
      await rename(source, destination);
      operations.cancel(id);
    });
    id = operations.createImage(destination, png);
    await operations.drained();
    expect(operations.all().find((job) => job.id === id)).toMatchObject({
      status: 'completed',
      undoable: true,
      completed: [{ source: '', destination: path.join(destination, 'Pasted image.png') }],
    });
    expect(await readFile(path.join(destination, 'Pasted image.png'))).toEqual(png);
  });
  it('writes the PNG as a journaled creation and delegates Undo to Trash after reopening', async () => {
    const job = await paste();
    const file = path.join(destination, 'Pasted image.png');
    expect(await readFile(file)).toEqual(png);
    expect(job).toMatchObject({
      kind: 'mkfile',
      undoable: true,
      completed: [{ source: '', destination: file }],
    });
    await operations.close();
    const saved = await new OperationLog(root).load();
    expect(saved.receipts[0]?.request).toMatchObject({ imageBytes: png.length });
    expect(JSON.stringify(saved)).not.toContain(png.toString('base64'));
    operations = new Operations(trash, () => {}, undefined, undefined, undefined, root);
    await operations.undo(job.id);
    expect(trash).toHaveBeenCalledExactlyOnceWith(file);
    expect(operations.all()[0]).toMatchObject({ undoable: false });
    expect(operations.all()[0]?.redoable).not.toBe(true);
    // The injected Trash adapter records the request and keeps the fixture intact.
    expect(await readFile(file)).toEqual(png);
  });
  it('numbers later pictures and keeps earlier ones intact', async () => {
    const jobs = await Promise.all([paste(), paste(), paste()]);
    expect(jobs.map((job) => path.basename(job.completed[0]!.destination!))).toEqual([
      'Pasted image.png',
      'Pasted image 2.png',
      'Pasted image 3.png',
    ]);
    for (const name of (await readdir(destination)).filter((name) => name.endsWith('.png')))
      expect(await readFile(path.join(destination, name))).toEqual(png);
  });
  it('accepts the size limit and refuses an oversized PNG Blob before arrayBuffer()', async () => {
    expect(() => checkClipboardImageSize(MAX_CLIPBOARD_IMAGE_BYTES)).not.toThrow();
    // A full-screen capture of a large display: well past the 4 MiB bound on text saves.
    expect(() => checkClipboardImageSize(24 * 1024 * 1024)).not.toThrow();
    await paste();
    // getType has already produced the Blob; the refusal avoids copying it into another buffer.
    const arrayBuffer = vi.fn();
    const getType = vi.fn(async () => ({ size: MAX_CLIPBOARD_IMAGE_BYTES + 1, arrayBuffer }));
    vi.mocked(clipboard.read).mockResolvedValueOnce([
      { types: ['image/png'], getType } as unknown as ClipboardItem,
    ]);
    await expect(handler()([destination], 1)).rejects.toThrow(
      'Pasted pictures must be 64 MiB or smaller as PNG.',
    );
    expect(getType).toHaveBeenCalledExactlyOnceWith('image/png');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(() =>
      operations.createImage(destination, Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES + 1)),
    ).toThrow('Pasted pictures must be 64 MiB or smaller as PNG.');
    expect(operations.all()).toHaveLength(1);
    expect((await readdir(destination)).filter((name) => name.endsWith('.png'))).toEqual([
      'Pasted image.png',
    ]);
  });
  it('leaves a picture someone edited in place when Undo is requested', async () => {
    const job = await paste();
    const file = job.completed[0]!.destination!;
    await writeFile(file, 'changed generated picture');
    await expect(operations.undo(job.id)).rejects.toThrow('changed since the operation');
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('changed generated picture');
  });
  it('keeps the picture and Undo receipt when Trash refuses it', async () => {
    const job = await paste();
    trash.mockRejectedValueOnce(new Error('Trash is unavailable.'));
    await expect(operations.undo(job.id)).rejects.toThrow('Trash is unavailable.');
    expect(await readFile(job.completed[0]!.destination!)).toEqual(png);
    expect(operations.all()[0]?.undoable).toBe(true);
  });
  it('refuses an agent picture-paste proposal before dispatching a command', async () => {
    await expect(pasteboard.read()).resolves.toEqual({ paths: [], cut: false, image: true });
    const execute = vi.fn(async () => {});
    const settings = new SettingsService(
      root,
      root,
      () => true,
      () => {},
    );
    const requests = new AgentRequests(root, settings, () => {}, execute, {
      read: () => ({ cwd: destination, output: '' }),
    });
    await expect(
      requests.command(
        'paste',
        {
          workspaceID: 'workspace',
          rootID: 'root',
          paneID: 'folder',
          directory: destination,
          selection: [],
        },
        'Paste here',
      ),
    ).rejects.toThrow('outside the captured selection');
    expect(execute).not.toHaveBeenCalled();
    expect(clipboard.read).not.toHaveBeenCalled();
    expect(operations.all()).toEqual([]);
  });
  it('allows the person to paste a picture while an agent command is in flight', async () => {
    const create = vi.spyOn(operations, 'createImage');
    offerImage();
    const result = await handler(true)([destination], 1);
    await operations.drained();
    expect(create).toHaveBeenCalledExactlyOnceWith(destination, png, 'agent');
    expect(operations.all().find((job) => job.id === result?.id)?.status).toBe('completed');
    expect(await readFile(path.join(destination, 'Pasted image.png'))).toEqual(png);
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'preserves file paste and its recording hook with cut=%s and agent in flight=%s',
    async (cut, agent) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      const files = [path.join(root, 'original.png')];
      await pasteboard.write(files, cut);
      native.clipboardRead.mockReturnValueOnce({
        files: files.map((file) => ({ path: file, directory: false })),
        changeCount: 7,
      });
      const start = vi.fn(() => 'file-job');
      const createImage = vi.fn();
      const recorded = vi.fn(async () => {});
      const pasteFiles = createPasteboardHandlers({
        pasteboard,
        operations: { start, createImage },
        recorded,
        isAgent: () => agent,
        fileAccess: new FileAccess(root),
        window: () => undefined,
      }).clipboardPaste;
      expect(await pasteFiles([destination], 1)).toEqual({ id: 'file-job', image: false });
      const request = { kind: cut ? 'move' : 'copy', sources: files, destination };
      expect(start).toHaveBeenCalledExactlyOnceWith(request, agent ? 'agent' : 'person');
      expect(recorded).toHaveBeenCalledExactlyOnceWith(request, 'file-job');
      expect(createImage).not.toHaveBeenCalled();
      expect(clipboard.read).not.toHaveBeenCalled();
    },
  );
  it('rejects an image read across a newer native clipboard selection', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    offerImage();
    native.clipboardVersion.mockReturnValueOnce(8);
    await expect(handler()([destination], 1)).rejects.toThrow(
      'The clipboard changed; paste again.',
    );
    expect(operations.all()).toEqual([]);
    expect((await readdir(destination)).filter((name) => name.endsWith('.png'))).toEqual([]);
  });
  it('uses existing folder grants for the Store edition and refuses an ungranted destination', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.stubGlobal('process', Object.assign(Object.create(process), { mas: true }));
    const start = vi.fn(() => () => {});
    const access = new FileAccess(path.join(root, 'profile'), { start });
    try {
      await access.remember(destination, true, 'generated-folder-bookmark');
      await operations.close();
      operations = new Operations(
        trash,
        () => {},
        undefined,
        undefined,
        (files) => access.require(files),
      );
      await paste();
      expect(start).toHaveBeenCalledWith('generated-folder-bookmark');
      const ungranted = path.join(root, 'ungranted');
      await mkdir(ungranted);
      offerImage();
      const result = await handler()([ungranted], 1);
      await operations.drained();
      const job = operations.all().find((job) => job.id === result?.id)!;
      expect(job.status).toBe('failed');
      expect(job.errors[0]?.message).toBe(
        'Allow access to this folder using the folder picker, then try again.',
      );
      expect(await readdir(ungranted)).toEqual([]);
    } finally {
      await access.close();
      vi.unstubAllGlobals();
    }
  });
  it('reports the existing filesystem refusal for a read-only destination', async () => {
    const readOnly = path.join(root, 'read-only');
    await mkdir(readOnly);
    await chmod(readOnly, 0o500);
    try {
      offerImage();
      const result = await handler()([readOnly], 1);
      await operations.drained();
      const job = operations.all().find((job) => job.id === result?.id)!;
      expect(job.status).toBe('failed');
      expect(job.errors[0]?.message).toMatch(/EACCES|EPERM|EROFS/);
      expect(await readdir(readOnly)).toEqual([]);
    } finally {
      await chmod(readOnly, 0o700);
    }
  });
  it('pastes a picture rendition alongside text when the clipboard has no files', async () => {
    const getType = vi.fn(async () => new Blob([Uint8Array.from(png)], { type: 'image/png' }));
    vi.mocked(clipboard.read).mockResolvedValueOnce([
      { types: ['text/html', 'text/plain', 'image/png'], getType } as unknown as ClipboardItem,
    ]);
    const result = await handler()([destination], 1);
    await operations.drained();
    expect(operations.all().find((job) => job.id === result?.id)?.status).toBe('completed');
    expect(getType).toHaveBeenCalledExactlyOnceWith('image/png');
    expect(await readFile(path.join(destination, 'Pasted image.png'))).toEqual(png);
  });
});

describe('browser Copy Path', () => {
  it('writes exact multi-path text before clearing the old file-operation clipboard', async () => {
    const events: string[] = [];
    const complete = vi.fn(async () => {
      events.push('clear-files');
    });
    const clipboard = {
      writeText: vi.fn(async (text: string) => {
        events.push(text);
      }),
    };
    await copyBrowserPaths(
      ['/fixture/ș 日本語.txt', '/fixture/folder with spaces'],
      complete,
      clipboard,
    );
    expect(events).toEqual(['/fixture/ș 日本語.txt\n/fixture/folder with spaces', 'clear-files']);
  });
  it('reports denied clipboard permission and preserves the previous file selection', async () => {
    const complete = vi.fn(async () => {});
    const clipboard = {
      writeText: vi.fn(async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      }),
    };
    await expect(copyBrowserPaths(['/fixture/file'], complete, clipboard)).rejects.toThrow(
      'clipboard',
    );
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not claim success when the browser clipboard is unavailable', async () => {
    const complete = vi.fn(async () => {});
    await expect(copyBrowserPaths(['/fixture/file'], complete, undefined)).rejects.toThrow(
      'clipboard',
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
