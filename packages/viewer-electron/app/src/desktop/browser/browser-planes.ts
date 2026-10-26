import { BrowserWindow, session, sharedTexture } from 'electron';
import type { BrowserRequest, BrowserSnapshot } from '../../domain/previews/browser';
import { browserAddress } from '../../domain/previews/browser';
import { errorMessage } from '../../domain/errors';

interface Page {
  owner: number;
  id: string;
  window: BrowserWindow;
  visible: boolean;
  sending: boolean;
  transport: 'texture' | 'bitmap';
  lastPaint: number;
  error?: string;
  repaint?: boolean;
}
/** Web pages are guests in an isolated persistent Chromium profile. They never
 * receive Viewer's preload, filesystem protocols, agent routes or app session. */
export class BrowserPlanes {
  private pages = new Map<string, Page>();
  private configured = false;
  private closing?: Promise<void>;
  constructor(private owner: (id: number) => BrowserWindow | undefined) {}
  private key(owner: number, id: string) {
    return `${owner}:${id}`;
  }
  private get(owner: number, id: string): Page {
    const page = this.pages.get(this.key(owner, id));
    if (!page || !this.live(page)) throw new Error('This browser plane has closed.');
    return page;
  }
  private live(page: Page): boolean {
    return (
      this.pages.get(this.key(page.owner, page.id)) === page &&
      !page.window.isDestroyed() &&
      !page.window.webContents.isDestroyed()
    );
  }
  private snapshot(page: Page): BrowserSnapshot {
    const contents = page.window.webContents;
    return {
      id: page.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      back: contents.navigationHistory.canGoBack(),
      forward: contents.navigationHistory.canGoForward(),
      zoom: contents.getZoomFactor(),
      transport: page.transport,
      error: page.error,
    };
  }
  private publish(page: Page) {
    const owner = this.owner(page.owner);
    if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed() && this.live(page))
      owner.webContents.send('viewer:event', { type: 'browser', browser: this.snapshot(page) });
  }
  private profile() {
    const profile = session.fromPartition('persist:viewer-browser-v1');
    if (!this.configured) {
      this.configured = true;
      profile.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
      profile.setPermissionCheckHandler(() => false);
      profile.on('will-download', (event) => event.preventDefault());
      profile.webRequest.onBeforeRequest((request, reply) => {
        let permitted = false;
        try {
          permitted = ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:', 'about:'].includes(
            new URL(request.url).protocol,
          );
        } catch {
          /* fail closed */
        }
        reply({ cancel: !permitted });
      });
    }
    return profile;
  }
  async request(owner: number, request: BrowserRequest): Promise<BrowserSnapshot | void> {
    if (this.closing) throw new Error('Browser planes are closing.');
    if (!this.owner(owner) || this.owner(owner)!.isDestroyed())
      throw new Error('The owning Viewer window closed.');
    if (request.kind === 'close') {
      this.close(owner, request.id);
      return;
    }
    if (request.kind === 'open') {
      const key = this.key(owner, request.id);
      const current = this.pages.get(key);
      if (current && this.live(current)) {
        current.visible = true;
        current.window.webContents.startPainting();
        current.window.webContents.invalidate();
        return this.snapshot(current);
      }
      if (current) this.close(owner, request.id);
      if (this.pages.size >= 8) throw new Error('Close a browser plane before opening another.');
      const texture = request.texture === true && !!sharedTexture;
      const window = new BrowserWindow({
        show: false,
        width: request.width,
        height: request.height,
        backgroundColor: '#ffffff',
        webPreferences: {
          session: this.profile(),
          offscreen: { useSharedTexture: texture },
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
          spellcheck: true,
        },
      });
      const page: Page = {
        owner,
        id: request.id,
        window,
        visible: true,
        sending: false,
        lastPaint: 0,
        transport: texture ? 'texture' : 'bitmap',
      };
      this.pages.set(key, page);
      const contents = window.webContents;
      contents.setFrameRate(texture ? 30 : 15);
      contents.setWindowOpenHandler(({ url }) => {
        try {
          this.navigate(page, browserAddress(url));
        } catch {
          /* unsupported scheme stays outside Viewer */
        }
        return { action: 'deny' };
      });
      contents.on('will-navigate', (event, url) => {
        try {
          browserAddress(url);
        } catch {
          event.preventDefault();
        }
      });
      contents.on('will-redirect', (event, url) => {
        try {
          browserAddress(url);
        } catch {
          event.preventDefault();
        }
      });
      const changed = () => this.publish(page);
      contents.on('did-start-loading', changed);
      contents.on('did-stop-loading', changed);
      contents.on('did-navigate', changed);
      contents.on('did-navigate-in-page', changed);
      contents.on('page-title-updated', changed);
      contents.on('did-fail-load', (_event, code, description, _url, main) => {
        if (main && code !== -3) {
          page.error = description;
          this.publish(page);
        }
      });
      contents.on('render-process-gone', (_event, details) => {
        page.error = `Page process stopped (${details.reason}). Reload to try again.`;
        this.publish(page);
      });
      contents.on('paint', (event, _dirty, image) => {
        const texture = event.texture;
        const target = this.owner(owner);
        if (
          !target ||
          target.isDestroyed() ||
          target.webContents.isDestroyed() ||
          !this.live(page) ||
          !page.visible
        ) {
          texture?.release();
          return;
        }
        if (page.sending) {
          page.repaint = true;
          texture?.release();
          return;
        }
        page.sending = true;
        page.lastPaint = performance.now();
        const send = async () => {
          if (texture && page.transport === 'texture') {
            let imported: Electron.SharedTextureImported | undefined;
            try {
              imported = sharedTexture.importSharedTexture({
                textureInfo: texture.textureInfo,
                allReferencesReleased: () => texture.release(),
              });
              await sharedTexture.sendSharedTexture(
                { frame: target.webContents.mainFrame, importedSharedTexture: imported },
                page.id,
              );
              return;
            } catch {
              if (!imported) texture.release();
              page.transport = 'bitmap';
              contents.setFrameRate(15);
              this.publish(page);
            } finally {
              imported?.release();
            }
          } else texture?.release();
          const frame = image.isEmpty() ? await contents.capturePage() : image;
          if (!target.isDestroyed() && !window.isDestroyed() && page.visible) {
            const size = frame.getSize();
            if (size.width * size.height > 16_777_216) return;
            target.webContents.send('viewer:browser-bitmap', {
              id: page.id,
              width: size.width,
              height: size.height,
              pixels: frame.toBitmap(),
            });
          }
        };
        void send()
          .catch(() => {})
          .finally(() => {
            page.sending = false;
            if (page.repaint && page.visible && this.live(page)) {
              page.repaint = false;
              contents.invalidate();
            }
          });
      });
      contents.debugger.attach('1.3');
      this.navigate(page, request.url);
      void contents.debugger
        .sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
        .catch(() => {});
      return this.snapshot(page);
    }
    const page = this.get(owner, request.id),
      contents = page.window.webContents;
    if (request.kind === 'state') return this.snapshot(page);
    if (request.kind === 'navigate') {
      this.navigate(page, request.url);
      return this.snapshot(page);
    }
    if (request.kind === 'viewport') {
      page.visible = request.visible;
      if (request.visible) {
        page.window.setContentSize(request.width, request.height);
        contents.startPainting();
        contents.invalidate();
      } else contents.stopPainting();
      return;
    }
    if (request.kind === 'input') {
      const input = request.event;
      if (!page.visible) return;
      if (input.type === 'text')
        await contents.debugger.sendCommand('Input.insertText', { text: input.text });
      else if (input.type === 'composition')
        await contents.debugger.sendCommand('Input.imeSetComposition', {
          text: input.text,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
        });
      else if (input.type === 'keyDown' || input.type === 'keyUp')
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', input);
      else await contents.debugger.sendCommand('Input.dispatchMouseEvent', input);
      return;
    }
    if (request.kind === 'action') {
      switch (request.action) {
        case 'back':
          if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
          break;
        case 'forward':
          if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
          break;
        case 'reload':
          page.error = undefined;
          contents.reload();
          break;
        case 'stop':
          contents.stop();
          break;
        case 'zoom-in':
          contents.setZoomFactor(Math.min(3, contents.getZoomFactor() + 0.1));
          break;
        case 'zoom-out':
          contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() - 0.1));
          break;
        case 'zoom-reset':
          contents.setZoomFactor(1);
          break;
        case 'copy':
          contents.copy();
          break;
        case 'cut':
          contents.cut();
          break;
        case 'paste':
          contents.paste();
          break;
        case 'select-all':
          contents.selectAll();
          break;
        case 'external': {
          const { shell } = await import('electron');
          await shell.openExternal(browserAddress(contents.getURL()));
          break;
        }
      }
      this.publish(page);
      return this.snapshot(page);
    }
  }
  private navigate(page: Page, url: string) {
    page.error = undefined;
    void page.window.loadURL(browserAddress(url)).catch((error) => {
      if (this.live(page)) {
        page.error = errorMessage(error);
        this.publish(page);
      }
    });
  }
  private close(owner: number, id: string) {
    const key = this.key(owner, id),
      page = this.pages.get(key);
    this.pages.delete(key);
    if (page && !page.window.isDestroyed()) page.window.destroy();
  }
  stopOwner(owner: number) {
    for (const page of [...this.pages.values()])
      if (page.owner === owner) this.close(owner, page.id);
  }
  closeAll(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = Promise.resolve().then(async () => {
      // Detach before destroy fires guest events, and stop loading/painting before
      // waiting for Chromium storage. webContents can die before its window.
      for (const page of [...this.pages.values()]) this.close(page.owner, page.id);
      if (this.configured) {
        await this.profile().cookies.flushStore();
        this.profile().flushStorageData();
      }
    });
    return this.closing;
  }
}
