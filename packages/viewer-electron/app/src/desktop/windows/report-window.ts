import { BrowserWindow, clipboard, dialog, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  reportCloseChannel,
  reportCopyChannel,
  reportOptionsChannel,
  reportUpdateChannel,
  reportShownChannel,
  reportReadyChannel,
} from '../../domain/diagnostics/report-window';
import type { ReportSnapshot, ReportUpdate } from '../../domain/diagnostics/report-window';
import { boundedReport } from '../../domain/diagnostics/text';
import { isolatedContent } from './web-content-policy';

export type ReportLook = 'light' | 'dark';

export const reportDisclosure =
  "By default, the report holds Viewer version and build, edition, license status, macOS version, Mac model, chip and memory when available, display count and scales, language, region, and each failure's time, kind, class, code and location in Viewer, with no personal file names or message text.";

export const reportMessageWarning =
  'Message text can contain file names, addresses and other private text. Viewer removes what it can recognize. Read it before you share it.';

/** Isolated local controls avoid giving any page a callable report or log reader. */
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
    [hidden] { display: none !important; }
    .report-options { display: grid; gap: 6px; }
    .report-options label { display: flex; align-items: center; gap: 8px; user-select: none; }
    .report-options label:focus-within { background: var(--selection); border-radius: 5px; }
    input { accent-color: var(--accent); }
    #message-warning, #report-status { color: var(--muted); font-size: 12px; }
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
    :root[data-look='light'] button:hover,
    :root[data-look='light'] button:focus-visible { filter: brightness(0.94); }
    button:active { filter: brightness(0.95); }
    button:disabled, :root[data-look='light'] button:disabled {
      opacity: 0.55; cursor: default; filter: none;
    }
  </style>
</head>
<body>
  <main aria-label="Copy Report" aria-describedby="privacy">
    <p id="privacy">${reportDisclosure}</p>
    <pre role="document" aria-label="Report" tabindex="0">${escape(report)}</pre>
    <section class="report-options" aria-label="Report options">
      <label><input id="include-message-text" type="checkbox" aria-describedby="message-warning">Include message text</label>
      <p id="message-warning" hidden>${reportMessageWarning}</p>
      <p id="report-status" role="status" hidden></p>
    </section>
    <footer>
      <p>Copy puts this report on the clipboard; other apps and your other devices may read it. You can paste it into Help → Report an Issue….</p>
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
    private makeReport: () => Promise<ReportSnapshot>,
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
    const snapshot = await this.makeReport();
    const defaultReport = boundedReport(snapshot.report);
    let visibleReport = defaultReport;
    let pending = true;
    let revision = 0;
    let generation = 0;
    let ready = false;
    let proposal: ReportUpdate | undefined;
    const look = this.look();
    const page = 'data:text/html,' + encodeURIComponent(reportPage(defaultReport, look));
    const isolated = session.fromPartition('viewer-report-' + randomUUID(), { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== page }),
    );
    const window = new BrowserWindow({
      title: 'Copy Report',
      width: 600,
      height: 640,
      minWidth: 440,
      minHeight: 480,
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
    window.webContents.on('did-start-loading', () => {
      generation++;
      revision = 0;
      visibleReport = defaultReport;
      pending = true;
      ready = false;
      proposal = undefined;
    });
    window.on('closed', () => {
      revision++;
      if (this.window === window) this.window = undefined;
    });
    let copying = false;
    const copy = async () => {
      if (copying || pending) return;
      copying = true;
      try {
        await clipboard.writeText(visibleReport);
        if (!window.isDestroyed()) window.close();
      } catch {
        copying = false;
        dialog.showErrorBox('Report not copied', 'Try Copy again.');
      }
    };
    const update = async (requested: number, includeMessageText: boolean) => {
      if (!ready || requested <= revision) return;
      revision = requested;
      const document = generation;
      pending = true;
      let result: ReportUpdate;
      try {
        result = {
          revision: requested,
          report: includeMessageText
            ? boundedReport(await snapshot.withMessageText())
            : defaultReport,
          includeMessageText,
        };
      } catch {
        result = {
          revision: requested,
          report: defaultReport,
          includeMessageText: false,
          error: 'Message text could not be prepared. The default report is shown.',
        };
      }
      if (requested !== revision || document !== generation || window.isDestroyed()) return;
      proposal = result;
      window.webContents.send(reportUpdateChannel, result);
    };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    for (const channel of [
      reportCopyChannel,
      reportCloseChannel,
      reportOptionsChannel,
      reportShownChannel,
      reportReadyChannel,
    ])
      window.webContents.ipc.on(channel, (event, ...args: unknown[]) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          return;
        if (channel === reportReadyChannel) {
          if (!args.length && !ready) {
            ready = true;
            pending = false;
          }
        } else if (channel === reportOptionsChannel) {
          if (
            args.length === 2 &&
            Number.isSafeInteger(args[0]) &&
            Number(args[0]) > 0 &&
            typeof args[1] === 'boolean'
          )
            void update(Number(args[0]), args[1]);
        } else if (channel === reportShownChannel) {
          if (
            args.length === 1 &&
            proposal &&
            args[0] === proposal.revision &&
            args[0] === revision
          ) {
            visibleReport = proposal.report;
            pending = false;
            proposal = undefined;
          }
        } else if (!args.length) {
          if (channel === reportCopyChannel) void copy();
          else window.close();
        }
      });
    try {
      await window.loadURL(page);
      if (this.present && !window.isDestroyed()) window.show();
    } catch {
      if (!window.isDestroyed()) window.close();
      // Electron includes the data URL in load errors, which must never enter the diagnostic log.
      throw new Error('The report window could not open.');
    }
  }
}
