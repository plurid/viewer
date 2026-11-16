import { BrowserWindow, clipboard, dialog, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { reportCopyChannel } from '../../domain/diagnostics/report-window';
import { isolatedContent } from './web-content-policy';

export type ReportLook = 'light' | 'dark';

export const reportDisclosure =
  'Names, personal paths, network addresses and credentials were removed; still read the report before sharing.';

/** The page has no scripts, links or report-reading API. The isolated preload only binds Copy. */
export function reportPage(report: string, look: ReportLook): string {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  return `<!doctype html>
<html lang="en" data-look="${look}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Copy Report</title>
  <style>
    :root {
      color-scheme: dark;
      --surface: #31353d; --field: #292d34; --ink: #f2f4f6;
      --muted: #b1bac6; --accent: #82b3cf; --space: #272a30; --selection: #3a5368;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--ink); background: var(--surface);
    }
    :root[data-look='light'] {
      color-scheme: light;
      --surface: #ffffff; --field: #f4f6f8; --ink: #202733;
      --muted: #546071; --accent: #337396; --space: #eef0f4; --selection: #dcebf4;
    }
    * { box-sizing: border-box; }
    ::selection { color: var(--ink); background: var(--selection); }
    html, body { height: 100%; margin: 0; }
    main { height: 100%; display: flex; flex-direction: column; gap: 16px; padding: 18px; }
    p, pre { margin: 0; }
    pre {
      flex: 1; min-height: 0; padding: 12px; border-radius: 5px;
      background: var(--field); white-space: pre-wrap; overflow-wrap: anywhere;
      overflow: auto; scrollbar-gutter: stable;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    :focus-visible { outline: none; }
    pre:focus-visible { background: var(--space); }
    footer { display: flex; align-items: center; gap: 16px; }
    footer p { flex: 1; color: var(--muted); font-size: 12px; }
    button {
      padding: 6px 10px; border: 1px solid transparent; border-radius: 5px;
      font: inherit; cursor: pointer; user-select: none;
      background: var(--accent); color: var(--space);
    }
    :root[data-look='light'] button { color: #ffffff; }
    button:hover, button:focus-visible { filter: brightness(1.12); }
    button:active { filter: brightness(0.95); }
  </style>
</head>
<body>
  <main aria-label="Copy Report" aria-describedby="privacy">
    <p id="privacy">${reportDisclosure}</p>
    <pre role="document" aria-label="Report" tabindex="0">${escape(report)}</pre>
    <footer>
      <p>Paste this report into Help → Report an Issue… after copying.</p>
      <button type="button">Copy</button>
    </footer>
  </main>
</body>
</html>`;
}

export class ReportWindow {
  window: BrowserWindow | undefined;
  private opening: Promise<void> | undefined;

  constructor(
    private makeReport: () => Promise<string>,
    private look: () => ReportLook,
    private present = true,
  ) {}

  async open(): Promise<void> {
    if (this.opening) return this.opening;
    if (this.window && !this.window.isDestroyed()) {
      if (this.present) {
        if (this.window.isMinimized()) this.window.restore();
        this.window.show();
        this.window.focus();
      }
      return;
    }
    this.opening = this.create().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  private async create(): Promise<void> {
    const report = await this.makeReport();
    const look = this.look();
    const page = 'data:text/html,' + encodeURIComponent(reportPage(report, look));
    const isolated = session.fromPartition('viewer-report-' + randomUUID(), { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== page }),
    );
    const window = new BrowserWindow({
      title: 'Copy Report',
      width: 600,
      height: 560,
      minWidth: 440,
      minHeight: 360,
      backgroundColor: look === 'light' ? '#ffffff' : '#31353d',
      show: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        ...isolatedContent,
        preload: path.join(__dirname, 'report-preload.cjs'),
        devTools: false,
        session: isolated,
      },
    });
    this.window = window;
    window.on('closed', () => {
      if (this.window === window) this.window = undefined;
    });
    let copying = false;
    const copy = async () => {
      if (copying) return;
      copying = true;
      try {
        await clipboard.writeText(report);
        if (!window.isDestroyed()) window.close();
      } catch {
        copying = false;
        dialog.showErrorBox('Report not copied', 'Try Copy again.');
      }
    };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    window.webContents.ipc.on(reportCopyChannel, (event, ...args: unknown[]) => {
      if (
        !args.length &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame
      )
        void copy();
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      if (input.key === 'Escape') {
        event.preventDefault();
        window.close();
      } else if (
        input.key === 'Enter' &&
        !input.control &&
        !input.meta &&
        !input.alt &&
        !input.shift
      ) {
        event.preventDefault();
        void copy();
      }
    });
    try {
      await window.loadURL(page);
      if (this.present && !window.isDestroyed()) window.show();
    } catch (error) {
      if (!window.isDestroyed()) window.close();
      throw error;
    }
  }
}
