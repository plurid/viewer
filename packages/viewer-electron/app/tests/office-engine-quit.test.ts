/** Quit with an Office layout open: no hidden engine window may outlive the windows Quit closes. */
import { beforeEach, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import type { Source } from '../src/desktop/previews/derived';
import type * as OfficeRendererModule from '../src/desktop/previews/office-renderer';

const electron = vi.hoisted(() => {
  /** Electron's hidden engine window: its page keeps loading, as the engine does for seconds. */
  class EngineWindow {
    static open = new Set<EngineWindow>();
    static made = 0;
    private destroyed = false;
    private closedListeners: (() => void)[] = [];
    readonly webContents = {
      setWindowOpenHandler() {},
      on() {},
      once() {},
    };
    constructor() {
      EngineWindow.made++;
      EngineWindow.open.add(this);
    }
    once(event: string, listener: () => void): this {
      if (event === 'closed') this.closedListeners.push(listener);
      return this;
    }
    loadURL(): Promise<void> {
      return new Promise<void>(() => {});
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.close();
    }
    close(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      EngineWindow.open.delete(this);
      for (const listener of this.closedListeners.splice(0)) listener();
    }
  }
  return { EngineWindow };
});
const { EngineWindow } = electron;

vi.mock('electron', () => ({
  BrowserWindow: electron.EngineWindow,
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      on() {},
      webRequest: { onBeforeRequest() {} },
    }),
  },
}));
vi.mock('../src/desktop/previews/office-assets', () => ({
  verifyOfficeRuntime: async () => {},
}));

type OfficeRenderer = typeof OfficeRendererModule;

const runtime = '/fixture/office-runtime';

/** The engine module as a new app process has it: Quit happens once per process. */
async function freshRenderer(): Promise<OfficeRenderer> {
  vi.resetModules();
  return import('../src/desktop/previews/office-renderer');
}

function wordDocument(): Source {
  const read = async (data: Buffer, offset: number, length: number) => {
    data.fill(65, offset, offset + length);
    return { bytesRead: length };
  };
  return {
    file: '/fixture/Report.docx',
    handle: { read },
    info: { size: 4, isFile: () => true },
    format: 'docx',
  } as unknown as Source;
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await delay(10);
  expect(condition()).toBe(true);
}

/** Enough turns for a loopback server to bind and an engine to make its window. */
const engineStartTime = () => delay(150);

/**
 * What the app does at Quit's last step: Viewer stops its Office engines, then Electron closes
 * every window open at that moment and quits only once no window is left.
 */
async function quitClosingWindows(renderer: OfficeRenderer): Promise<void> {
  const stopping = renderer.stopOfficeEngines();
  for (const window of [...EngineWindow.open]) window.close();
  await stopping;
}

beforeEach(() => {
  EngineWindow.open.clear();
  EngineWindow.made = 0;
});

it('ends a layout in progress at Quit and opens no engine window after it', async () => {
  const renderer = await freshRenderer();
  const layout = renderer.officeDecoder(runtime)(
    wordDocument(),
    'office',
    new AbortController().signal,
  );
  const failure = layout.then(
    () => 'rendered',
    (error: Error) => error.message,
  );
  await until(() => EngineWindow.open.size === 1);

  await quitClosingWindows(renderer);

  const message = await failure;
  // a layout's end starts the next document's engine, a window Electron would never close
  await engineStartTime();
  expect(EngineWindow.open.size).toBe(0);
  expect(EngineWindow.made).toBe(1);
  expect(message).toBe('Viewer is quitting.');
});

it('closes the waiting engine at Quit and starts none after', async () => {
  const renderer = await freshRenderer();
  renderer.warmOffice(runtime);
  await until(() => EngineWindow.open.size === 1);

  await renderer.stopOfficeEngines();

  expect(EngineWindow.open.size).toBe(0);
  renderer.warmOffice(runtime);
  await expect(
    renderer.renderOffice(runtime, Buffer.from('AAAA'), 'docx', new AbortController().signal),
  ).rejects.toThrow('Viewer is quitting.');
  await engineStartTime();
  expect(EngineWindow.open.size).toBe(0);
  expect(EngineWindow.made).toBe(1);
});

it('makes no window for an engine still starting when Quit stops it', async () => {
  const renderer = await freshRenderer();
  renderer.warmOffice(runtime);

  await renderer.stopOfficeEngines();

  await engineStartTime();
  expect(EngineWindow.made).toBe(0);
});
