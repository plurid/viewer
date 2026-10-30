/**
 * Layout, nesting, mail attachments and document packages in the packaged app. Each flow is
 * driven through its menus and controls and saved, and every file it writes is read back: PDFs
 * with qpdf and pdf.js, pictures with sharp, sheets with dxf-parser, attachments against their
 * decoded parts. The sources are copies of playground samples, with HEIC copies, a card and an A1
 * page made here. Every folder is kept.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import DxfParser from 'dxf-parser';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { OperationJob, SavedState, Workspace } from '../../src/domain/contracts';
import { formatBytes } from '../../src/domain/files/entries';
import { oriented, pagePresets } from '../../src/domain/layout/pages';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { animationFrames, countOf, exists, patchSettings, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary, 'Choose the packaged candidate.');
const playground = path.resolve(process.env.VIEWER_TEST_REAL_CORPUS ?? defaultPlaygroundDirectory);
const platform = `${process.platform}-${process.arch}`;
const qpdf = path.resolve(binary, `../../Resources/viewer-optimizers-${platform}/qpdf`);
const processors = fileURLToPath(
  new URL(`../../assets/viewer-processors-${platform}/`, import.meta.url),
);
const run = promisify(execFile);
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

interface Sharp {
  metadata(): Promise<{ width?: number; height?: number; format?: string; hasAlpha?: boolean }>;
  stats(): Promise<{ channels: { stdev: number }[] }>;
}
const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp')) as (
  input: Buffer,
) => Sharp;

const root = await realpath(await temporaryRoot('viewer-native-layout-'));
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
const evidence = path.join(root, 'Evidence');
await Promise.all([mkdir(files), mkdir(profile), mkdir(evidence)]);
const images = path.join(playground, 'previews', 'images');

/** A folder of its own for each flow, so what it saves lands beside only its own sources. */
async function folder(name: string): Promise<string> {
  const made = path.join(files, name);
  await mkdir(made);
  return made;
}
async function copy(from: string, into: string, name = path.basename(from)): Promise<string> {
  const to = path.join(into, name);
  await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return to;
}

/** A one-page PDF of `width` × `height` points: a frame, a grid and lines of searchable text. */
function drawingPDF(width: number, height: number, lines: readonly string[], size: number): Buffer {
  const text = lines
    .map(
      (line, index) =>
        `BT /F1 ${size} Tf ${size} ${height - size * (2 + index * 1.6)} Td (${line}) Tj ET`,
    )
    .join('\n');
  const grid = Array.from({ length: 9 }, (_, index) => {
    const x = ((index + 1) * width) / 10;
    const y = ((index + 1) * height) / 10;
    return `${x} 12 m ${x} ${height - 12} l ${12} ${y} m ${width - 12} ${y} l`;
  }).join(' ');
  const content = `0.2 0.3 0.6 RG 2 w 12 12 ${width - 24} ${height - 24} re S\n0.5 w ${grid} S\n0 g\n${text}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
const mm = (value: number) => (value * 72) / 25.4;

// Photos: three for a collage, three HEIC, twelve in as many formats for a contact sheet, one for
// prints.
const photos = await folder('Harbour photos');
const collageSources = [
  await copy(path.join(images, 'Image study.jpg'), photos),
  await copy(path.join(images, 'Image study.png'), photos),
  await copy(path.join(images, 'Image study.webp'), photos),
];
const phone = await folder('Phone pictures');
const heicSources = [
  await copy(path.join(images, 'Image study.heic'), phone),
  path.join(phone, 'Harbour.heic'),
  path.join(phone, 'Tower.heic'),
];
await run('/usr/bin/sips', [
  '-s',
  'format',
  'heic',
  path.join(images, 'Image study.jpg'),
  '--out',
  heicSources[1]!,
]);
await run('/usr/bin/sips', [
  '-r',
  '90',
  '-s',
  'format',
  'heic',
  path.join(images, 'Image study.png'),
  '--out',
  heicSources[2]!,
]);
const archive = await folder('Photo archive');
const archiveSources = [
  ...(await Promise.all(
    ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'gif', 'bmp', 'webp', 'avif'].map(
      (extension) => copy(path.join(images, 'Image study.' + extension), archive),
    ),
  )),
  await copy(path.join(images, 'camera-raw', 'Minolta-DiMAGE-5.MRW'), archive),
];
const prints = await folder('Studio prints');
const printSource = await copy(path.join(images, 'Image study.jpg'), prints);
const cards = await folder('Card stock');
const cardSource = path.join(cards, 'Card.pdf');
await writeFile(cardSource, drawingPDF(mm(85), mm(55), ['Ana Ionescu', 'Field team'], 11), {
  flag: 'wx',
});
const documents = await folder('Field documents');
const documentSource = await copy(
  path.join(playground, 'previews', 'documents', 'Field notes.pdf'),
  documents,
);
const posters = await folder('Site plan');
const posterSource = path.join(posters, 'Site plan.pdf');
await writeFile(
  posterSource,
  drawingPDF(mm(594), mm(841), ['Site plan', 'Lighthouse survey, north field'], 64),
  { flag: 'wx' },
);
const parts = await folder('Workshop parts');
const partNames = ['Bracket with holes', 'Disc', 'L-shape', 'Ring'];
const partSources = await Promise.all(
  partNames.map((name) => copy(path.join(playground, 'layout', 'nesting', name + '.dxf'), parts)),
);
const mail = await folder('Mail messages');
const messageSource = await copy(
  path.join(playground, 'previews', 'messages', 'Field trip.eml'),
  mail,
);
const message = await readFile(messageSource, 'latin1');
// The playground mailbox, and last a message with two attachments.
const mailbox = await folder('Mailbox');
const mailboxSource = path.join(mailbox, 'Field season.mbox');
const attached = {
  'North field.png': await readFile(path.join(images, 'Image study.png')),
  'Gear list.txt': Buffer.from('Tripod\nTwo lenses\nSpare batteries\nCafé receipt\n'),
};
const base64Lines = (bytes: Buffer) =>
  bytes
    .toString('base64')
    .match(/.{1,76}/g)!
    .join('\n');
await writeFile(
  mailboxSource,
  (await readFile(path.join(playground, 'previews', 'messages', 'Field team.mbox'), 'latin1')) +
    [
      '',
      'From mara@example.invalid Sat Mar  7 07:10:00 2026',
      'From: Mara Lin <mara@example.invalid>',
      'To: team@example.invalid',
      'Date: Sat, 07 Mar 2026 07:10:00 +0200',
      'Subject: Maps for Saturday',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="maps"',
      '',
      '--maps',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'The map and the gear list are attached.',
      ...Object.entries(attached).flatMap(([name, bytes]) => [
        '--maps',
        `Content-Type: ${name.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8'}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(bytes),
      ]),
      '--maps--',
      '',
    ].join('\n'),
  { encoding: 'latin1', flag: 'wx' },
);
const packages = await folder('Pages package');
const packageSource = await copy(
  path.join(playground, 'previews', 'saved-previews', 'Field notes package.pages'),
  packages,
);

interface Case {
  id: string;
  name: string;
  folder: string;
}
const cases = {
  photos: { id: 'photos', name: 'Harbour photos', folder: photos },
  heic: { id: 'heic', name: 'Phone pictures', folder: phone },
  archive: { id: 'archive', name: 'Photo archive', folder: archive },
  prints: { id: 'prints', name: 'Studio prints', folder: prints },
  cards: { id: 'cards', name: 'Card stock', folder: cards },
  documents: { id: 'documents', name: 'Field documents', folder: documents },
  poster: { id: 'poster', name: 'Site plan', folder: posters },
  parts: { id: 'parts', name: 'Workshop parts', folder: parts },
  mail: { id: 'mail', name: 'Mail messages', folder: mail },
  mailbox: { id: 'mailbox', name: 'Mailbox', folder: mailbox },
  package: { id: 'package', name: 'Pages package', folder: packages },
} satisfies Record<string, Case>;
const workspace = ({ id, name, folder }: Case): Workspace => ({
  id,
  name,
  roots: ['folder-' + id],
  activePane: 'folder-' + id,
  arrangement: {},
  panes: [
    {
      id: 'folder-' + id,
      type: 'folder',
      path: folder,
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: [folder],
      historyIndex: 0,
    },
  ],
});
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: cases.photos.id,
  favorites: [],
  recents: [],
  ui,
  workspaces: Object.values(cases).map(workspace),
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });

// Output checks, outside the app.

interface PDFPage {
  width: number;
  height: number;
  text: string;
  images: number;
}
async function checkPDF(file: string): Promise<PDFPage[]> {
  const { stdout } = await run(qpdf, ['--check', file]);
  assert.match(stdout, /No syntax or stream encoding errors found/, file);
  const task = getDocument({ data: new Uint8Array(await readFile(file)) });
  const document = await task.promise;
  try {
    const pages: PDFPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const [left, bottom, right, top] = page.view as [number, number, number, number];
      const content = await page.getTextContent();
      const operators = await page.getOperatorList();
      pages.push({
        width: right - left,
        height: top - bottom,
        text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
        images: operators.fnArray.filter((operator) => operator === OPS.paintImageXObject).length,
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
/** Checks a page is the size a summary names: "A4 landscape", "Tabloid landscape". */
function assertPage(page: PDFPage, name: string): void {
  const [, label, orientation] = /^(.+) (portrait|landscape)$/.exec(name) ?? [];
  const preset = pagePresets.find((item) => item.label === label);
  assert.ok(preset && orientation, 'A named page: ' + name);
  const expected = oriented(preset, orientation as 'portrait' | 'landscape');
  assert.ok(
    Math.abs(page.width - expected.width) < 1 && Math.abs(page.height - expected.height) < 1,
    `${page.width} × ${page.height} points is ${name}`,
  );
}
/** A picture's size and whether it holds more than one flat colour. */
async function checkPicture(file: string) {
  const picture = sharp(await readFile(file));
  const { width = 0, height = 0, format, hasAlpha = false } = await picture.metadata();
  const { channels } = await picture.stats();
  return {
    width,
    height,
    format,
    alpha: hasAlpha,
    varied: channels.some((channel) => channel.stdev > 4),
  };
}
/** The part of a MIME message whose headers hold `header`, decoded from its transfer encoding. */
function mimePart(source: string, header: string): Buffer {
  const lines = source.split('\r\n');
  const named = lines.findIndex((line) => line.includes(header));
  assert.ok(named > 0, 'The message names ' + header);
  let start = named;
  while (start > 0 && !lines[start - 1]!.startsWith('--')) start--;
  const blank = lines.indexOf('', named);
  let end = blank + 1;
  while (end < lines.length && !lines[end]!.startsWith('--')) end++;
  const headers = lines.slice(start, blank).join('\n');
  const body = lines.slice(blank + 1, end);
  const encoding = /content-transfer-encoding:\s*(\S+)/i.exec(headers)?.[1]?.toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.join(''), 'base64');
  if (encoding === 'quoted-printable')
    return Buffer.from(
      body
        .join('\r\n')
        .replace(/=\r\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      'latin1',
    );
  return Buffer.from(body.join('\r\n'), 'latin1');
}
async function quarantine(file: string): Promise<string> {
  const { stdout } = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file]);
  return stdout.trim();
}
async function packageBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await packageBytes(file) : (await stat(file)).size;
  }
  return total;
}

// Page functions: each uses only its own body and arguments.

/** Selects exactly `paths` in the folder list, as a click and ⌘-clicks do; false while a row is
 * not shown yet. */
function selectRows(paths: string[]): boolean {
  const rows = paths.map((file) =>
    [...document.querySelectorAll<HTMLElement>('.folder-explorer [data-file-path]')].find(
      (row) => row.dataset.filePath === file,
    ),
  );
  if (rows.some((row) => !row)) return false;
  rows.forEach((row, index) =>
    row!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: index > 0 }),
    ),
  );
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
  return true;
}
function openContextMenu(file: string): boolean {
  const row = [...document.querySelectorAll<HTMLElement>('.folder-explorer [data-file-path]')].find(
    (row) => row.dataset.filePath === file,
  );
  if (!row) return false;
  const box = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: box.left + 60,
      clientY: box.top + box.height / 2,
    }),
  );
  return true;
}
/** The rows of the context menu's Suggested section, as shown. */
function suggestedRows(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '.context-menu [role="group"][aria-label="Suggested"] .command-result',
    ),
  ].map((row) => row.innerText.replace(/\s+/g, ' ').trim());
}
function layoutState() {
  const plane = document.querySelector<HTMLElement>('.layout-plane');
  const all = (selector: string) => [...(plane?.querySelectorAll<HTMLElement>(selector) ?? [])];
  const text = (element: Element | null | undefined) => element?.textContent.trim() ?? '';
  return {
    open: !!plane,
    loading: text(plane?.querySelector('.loading')),
    failure: plane ? '' : text(document.querySelector('.empty-state')),
    modes: all('[aria-label="Layout mode"] button').map(text),
    mode: text(plane?.querySelector('[aria-label="Layout mode"] button[aria-pressed="true"]')),
    summary: text(plane?.querySelector('.layout-toolbar [role="status"]')),
    name: plane?.querySelector<HTMLInputElement>('[aria-label="Output name"]')?.value ?? '',
    save: text(plane?.querySelector('.layout-options button.primary')),
    suggested: all('[aria-label="Suggested layouts"] button strong').map(text),
    pictures: all('.layout-stage svg image').length,
    placeholders: all('.layout-stage .layout-placeholder').length,
    problem: text(plane?.querySelector('.layout-main .empty-state')),
    notice: text(plane?.querySelector('.layout-notice')),
    jobs: all('.layout-job').map(text),
    error: text(plane?.querySelector('.layout-options [role="alert"]')),
  };
}
function nestingState() {
  const panel = document.querySelector<HTMLElement>('.nesting-panel');
  const text = (element: Element | null | undefined) => element?.textContent.trim() ?? '';
  return {
    open: !!panel,
    quantities: [
      ...(panel?.querySelectorAll<HTMLInputElement>('input[aria-label^="Quantity of "]') ?? []),
    ].map((input) => ({ part: input.getAttribute('aria-label')!.slice(12), value: input.value })),
    heading: text(panel?.querySelector('.nesting-summary h2')),
    status: text(panel?.querySelector('.nesting-status')),
    saved: text(panel?.querySelector('.nesting-saved')),
    problems: [...(panel?.querySelectorAll('.nesting-problem') ?? [])].map(text),
    sheets: panel?.querySelectorAll('.nesting-sheets svg').length ?? 0,
    files: text(panel?.querySelector('.nesting-sidebar')),
  };
}
function mailState() {
  const preview = document.querySelector<HTMLElement>('.quick-preview');
  return {
    attachments: [
      ...(preview?.querySelectorAll<HTMLElement>('.mail-attachments .mail-attachment-name') ?? []),
    ].map((name) => name.textContent.trim()),
    messages: preview?.querySelectorAll('ol.mailbox-messages button').length ?? 0,
    subject: preview?.querySelector('.mail-subject')?.textContent.trim() ?? '',
    error: preview?.querySelector('.empty-state')?.textContent.trim() ?? '',
  };
}
function chooseMessage(index: number): void {
  document
    .querySelectorAll<HTMLButtonElement>('.quick-preview ol.mailbox-messages button')
    [index]!.click();
}
function previewFooter(): string {
  return (
    document
      .querySelector('.preview-plane .preview-info .preview-file-details')
      ?.textContent.trim() ?? ''
  );
}
const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
interface Check {
  flow: string;
  passed: boolean;
  milliseconds: number;
  details?: unknown;
  error?: string;
}
const checks: Check[] = [];
const screenshots: string[] = [];
const consoleProblems: string[] = [];
try {
  connection = await app.connect();
  const { evaluate, command, onEvent } = connection;
  await command('Runtime.enable');
  onEvent((method, params) => {
    if (method === 'Runtime.exceptionThrown')
      consoleProblems.push(JSON.stringify(params).slice(0, 800));
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(String(params.type)))
      consoleProblems.push(JSON.stringify(params.args).slice(0, 800));
  });
  const actions = new NativeInteractions({ evaluate, command, until });
  const jobs = () => evaluate(pageCall(() => window.viewer.jobs()));
  const look = async (value: 'light' | 'dark') => {
    await evaluate(patchSettings({ path: 'settings.appearance', value }));
    await until(
      () => evaluate(pageCall(() => document.documentElement.dataset.look)),
      (shown) => shown === value,
      value + ' appearance',
    );
  };
  /** The window, once `shown` has faded in, in dark and then in light. */
  const capture = async (name: string, shown: string) => {
    await actions.visible(shown);
    for (const value of ['dark', 'light'] as const) {
      await look(value);
      await evaluate(pageCall(pause, 400));
      const file = path.join(evidence, `${name}-${value}.png`);
      await actions.capture(file);
      screenshots.push(file);
    }
    await look('dark');
  };
  const flow = async (name: string, work: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      const details = await work();
      checks.push({ flow: name, passed: true, milliseconds: Date.now() - started, details });
      console.log('PASS', name, JSON.stringify(details ?? ''));
    } catch (error) {
      const failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
      checks.push({
        flow: name,
        passed: false,
        milliseconds: Date.now() - started,
        error: failure,
      });
      console.log('FAIL', name, failure);
      const shot = path.join(evidence, 'failed-' + name.replace(/[^a-zA-Z0-9]+/g, '-') + '.png');
      await actions.capture(shot).catch(() => undefined);
      console.log(
        '  Window text:',
        await evaluate(pageCall(() => document.body.innerText.slice(0, 3000))).catch(() => ''),
      );
      await actions.key('Escape', 'Escape').catch(() => undefined);
    }
  };
  /** Shows a flow's workspace and selects `sources` in its folder. */
  const select = async (flowCase: Case, sources: readonly string[]) => {
    await actions.palette(flowCase.name);
    await until(
      () =>
        evaluate(
          pageCall(
            (folder: string) =>
              [...document.querySelectorAll<HTMLElement>('.folder-explorer [data-file-path]')]
                .length > 0 &&
              [
                ...document.querySelectorAll<HTMLElement>('.folder-explorer [data-file-path]'),
              ].every((row) => row.dataset.filePath!.startsWith(folder + '/')),
            flowCase.folder,
          ),
        ),
      Boolean,
      'Folder of ' + flowCase.name,
    );
    await until(
      () => evaluate(pageCall(selectRows, [...sources])),
      Boolean,
      'Rows of ' + flowCase.name,
    );
    await until(
      () => evaluate(countOf('.folder-explorer [data-file-path][aria-selected="true"]')),
      (count) => count === sources.length,
      'Selected in ' + flowCase.name,
    );
  };
  /** Runs `label` from the command palette opened with ⌘K, as a person types it. */
  const commandKey = async (label: string) => {
    await actions.key('k', 'KeyK', 4);
    await until(
      () => evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label') ?? '')),
      (value) => value === 'Search commands',
      '⌘K opens the palette',
    );
    await command('Input.insertText', { text: label });
    await until(
      () => evaluate(textOf('.command-result[aria-selected=true]')),
      (text) => text.includes(label),
      'Palette result ' + label,
    );
    await actions.key('Enter', 'Enter');
  };
  /** Waits for the Layout plane to read its files and draw its first page. */
  const layoutReady = async (label: string) => {
    const shown = await until(
      () => evaluate(pageCall(layoutState)),
      (value) =>
        !!value.failure ||
        !!value.problem ||
        (value.open &&
          !value.loading &&
          !!value.mode &&
          (!!value.summary || value.mode === 'Nesting')),
      'Layout plane for ' + label,
      90_000,
    );
    assert.equal(shown.failure, '', 'The files are read');
    assert.equal(shown.problem, '', 'The layout can be made');
    // pictures arrive a few at a time
    await until(
      () => evaluate(pageCall(layoutState)),
      (value) => value.placeholders === 0,
      'Pictures of ' + label,
      60_000,
    ).catch(() => undefined);
    return evaluate(pageCall(layoutState));
  };
  const chooseMode = async (label: string) => {
    await actions.button(label, '.layout-plane [aria-label="Layout mode"]');
    await until(
      () => evaluate(pageCall(layoutState)),
      (value) => value.mode === label && !!value.summary,
      'Mode ' + label,
    );
    return layoutReady(label);
  };
  /** Presses Save in the Layout plane and waits for its job; the saved file. */
  const saveLayout = async (label: string) => {
    const before = new Set((await jobs()).map((job) => job.id));
    await actions.button(label, '.layout-options');
    const job = await until(
      jobs,
      (list) =>
        list.some(
          (job) => !before.has(job.id) && ['completed', 'failed', 'cancelled'].includes(job.status),
        ),
      'Saved ' + label,
      180_000,
    ).then((list) => list.find((job) => !before.has(job.id))!);
    assert.equal(job.status, 'completed', JSON.stringify(job.errors));
    assert.equal(job.kind, 'convert');
    const destination = job.completed[0]?.destination;
    assert.ok(destination, 'The job names its output');
    await until(
      () => evaluate(pageCall(layoutState)),
      (value) =>
        value.jobs.some(
          (text) => text.includes('Saved') && text.includes(path.basename(destination)),
        ),
      'Saved and Open ' + path.basename(destination),
    );
    return { job, file: destination };
  };
  /** Undo moves the output to the Trash, which this run refuses (AGENTS.md): it stays. */
  const undoRefused = async (job: OperationJob, file: string) => {
    assert.equal(job.undoable, true, 'The save can be undone');
    await actions.palette('Undo file operation');
    const notice = await until(
      () => evaluate(textOf('.notice')),
      (text) => text.includes('Automated native tests cannot move'),
      'Undo refused in the window',
    );
    await actions.click('.notice [aria-label="Dismiss message"]');
    await assert.rejects(
      evaluate(pageCall((id: string) => window.viewer.undo(id), job.id)),
      /Automated native tests cannot move /,
    );
    await stat(file);
    return notice;
  };

  await until(
    () => evaluate(countOf('.folder-explorer [data-file-path]')),
    (count) => count === collageSources.length,
    'Harbour photos listed',
  );

  await flow('Collage of 3 photos, from the Suggested row', async () => {
    await select(cases.photos, collageSources);
    assert.ok(await evaluate(pageCall(openContextMenu, collageSources[0]!)));
    const suggested = await until(
      () => evaluate(pageCall(suggestedRows)),
      (rows) => rows.length > 0,
      'Suggested rows',
    );
    assert.ok(
      suggested.some((row) => row.includes('Lay out…') && row.includes('Collage of 3 photos')),
      JSON.stringify(suggested),
    );
    await actions.click('.context-menu [data-menu-id="suggested.lay-out"]');
    const shown = await layoutReady('collage');
    assert.equal(shown.mode, 'Collage');
    assert.equal(shown.name, 'Collage of 3 photos');
    assert.ok(shown.modes.includes('Contact sheet'), JSON.stringify(shown.modes));
    assert.ok(shown.suggested.length > 1, 'Suggested layouts: ' + JSON.stringify(shown.suggested));
    const pixels = /(\d+) × (\d+) px/.exec(shown.summary);
    assert.ok(pixels, shown.summary);
    await capture('collage', '.layout-plane');
    const jpeg = await saveLayout(shown.save.startsWith('Save JPEG') ? shown.save : 'Save JPEG');
    const picture = await checkPicture(jpeg.file);
    assert.equal(path.basename(jpeg.file), 'Collage of 3 photos.jpg');
    assert.equal(picture.format, 'jpeg');
    assert.deepEqual([picture.width, picture.height], [Number(pixels[1]), Number(pixels[2])]);
    assert.ok(picture.varied, 'The photos are drawn');
    const undo = await undoRefused(jpeg.job, jpeg.file);
    await actions.button('PDF', '.layout-options [aria-label="Format"]');
    await until(
      () => evaluate(pageCall(layoutState)),
      (value) => value.save === 'Save PDF',
      'PDF chosen',
    );
    const pdf = await saveLayout('Save PDF');
    assert.equal(path.basename(pdf.file), 'Collage of 3 photos.pdf');
    const pages = await checkPDF(pdf.file);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]!.images, 3, 'Each photo placed once');
    assert.ok(
      Math.abs(pages[0]!.width / pages[0]!.height - picture.width / picture.height) < 0.01,
      'The PDF page has the JPEG’s shape',
    );
    return { summary: shown.summary, jpeg: picture, pdf: pages, undo };
  });

  await flow('Collage of 3 HEIC photos', async () => {
    await select(cases.heic, heicSources);
    await actions.palette('Lay out');
    const shown = await layoutReady('HEIC collage');
    assert.equal(shown.mode, 'Collage');
    assert.equal(shown.name, 'Collage of 3 photos');
    assert.equal(shown.notice, '', 'No photo is left out');
    await capture('collage-heic', '.layout-plane');
    const pixels = /(\d+) × (\d+) px/.exec(shown.summary);
    assert.ok(pixels, shown.summary);
    const saved = await saveLayout('Save JPEG');
    const picture = await checkPicture(saved.file);
    assert.deepEqual([picture.width, picture.height], [Number(pixels[1]), Number(pixels[2])]);
    assert.ok(picture.varied, 'The HEIC photos are drawn');
    // a PNG without a background keeps its margins and gaps transparent
    await actions.button('PNG', '.layout-options [aria-label="Format"]');
    await actions.click('.layout-options [aria-label="Transparent"]');
    await until(
      () => evaluate(pageCall(layoutState)),
      (value) => value.save === 'Save PNG',
      'Transparent PNG chosen',
    );
    await capture('collage-transparent', '.layout-plane');
    const clear = await saveLayout('Save PNG');
    assert.equal(path.basename(clear.file), 'Collage of 3 photos.png');
    const png = await checkPicture(clear.file);
    assert.equal(png.format, 'png');
    assert.equal(png.alpha, true, 'Transparent where nothing is drawn');
    assert.deepEqual([png.width, png.height], [picture.width, picture.height]);
    return { summary: shown.summary, jpeg: picture, png };
  });

  await flow('Contact sheet of 12 photos', async () => {
    await select(cases.archive, archiveSources);
    await commandKey('Lay out');
    const shown = await layoutReady('contact sheet');
    assert.equal(shown.mode, 'Contact sheet');
    assert.equal(shown.name, 'Contact sheet of 12 photos');
    assert.equal(shown.notice, '', 'No photo is left out');
    const grid = /^(\d+) columns · (\d+) pages? · (.+)$/.exec(shown.summary);
    assert.ok(grid, shown.summary);
    await capture('contact-sheet', '.layout-plane');
    const saved = await saveLayout('Save PDF');
    const pages = await checkPDF(saved.file);
    assert.equal(pages.length, Number(grid[2]));
    for (const page of pages) assertPage(page, grid[3]!);
    assert.equal(
      pages.reduce((sum, page) => sum + page.images, 0),
      12,
      'Each photo placed once',
    );
    const text = pages.map((page) => page.text).join(' ');
    for (const name of ['Image study.avif', 'Minolta-DiMAGE-5.MRW'])
      assert.ok(text.includes(name), 'Caption ' + name);
    return { summary: shown.summary, pages: pages.length };
  });

  await flow('Step and repeat of 1 photo', async () => {
    await select(cases.prints, [printSource]);
    await actions.palette('Lay out');
    const shown = await layoutReady('step and repeat');
    assert.equal(shown.mode, 'Step and repeat');
    const grid = /^(\d+) per sheet · 1 sheet · (.+)$/.exec(shown.summary);
    assert.ok(grid, shown.summary);
    await capture('step-repeat', '.layout-plane');
    const saved = await saveLayout(shown.save);
    assert.equal(path.basename(saved.file), shown.name + '.pdf');
    const pages = await checkPDF(saved.file);
    assert.equal(pages.length, 1);
    assertPage(pages[0]!, grid[2]!);
    assert.equal(pages[0]!.images, Number(grid[1]), 'One print per cell');
    return { name: shown.name, summary: shown.summary };
  });

  await flow('Card 10 up', async () => {
    await select(cases.cards, [cardSource]);
    await actions.palette('Lay out');
    const shown = await layoutReady('cards');
    assert.equal(shown.mode, 'Step and repeat');
    assert.equal(shown.name, 'Card 10 up');
    assert.equal(shown.summary, '10 per sheet · 1 sheet · A4 portrait');
    const saved = await saveLayout('Save PDF');
    const pages = await checkPDF(saved.file);
    assert.equal(pages.length, 1);
    assertPage(pages[0]!, 'A4 portrait');
    assert.equal(pages[0]!.images, 0, 'The card is placed as vector');
    assert.equal(pages[0]!.text.split('Ana Ionescu').length - 1, 10, 'Its text, ten times');
    return { summary: shown.summary };
  });

  await flow('N-up and booklet of a 3-page PDF', async () => {
    await select(cases.documents, [documentSource]);
    await actions.palette('Lay out');
    const nUp = await layoutReady('N-up');
    assert.equal(nUp.mode, 'N-up');
    const grid = /^(\d+) per sheet · (\d+) sheets? · (.+)$/.exec(nUp.summary);
    assert.ok(grid, nUp.summary);
    assert.equal(nUp.name, `Field notes ${grid[1]} up`);
    await capture('n-up', '.layout-plane');
    const first = await saveLayout('Save PDF');
    const sheets = await checkPDF(first.file);
    assert.equal(sheets.length, Number(grid[2]));
    for (const page of sheets) assertPage(page, grid[3]!);
    assert.ok(sheets[0]!.text.includes('A spatial project brief'), 'Source text stays text');
    const booklet = await chooseMode('Booklet');
    assert.equal(booklet.name, 'Booklet of Field notes');
    // Letter pages fold from the sheet that holds two of them at their size
    const folded = /^(\d+) sheets? · 4 pages, 1 blank · (.+ landscape)$/.exec(booklet.summary);
    assert.ok(folded, booklet.summary);
    await capture('booklet', '.layout-plane');
    const second = await saveLayout('Save PDF');
    assert.equal(path.basename(second.file), 'Booklet of Field notes.pdf');
    const sides = await checkPDF(second.file);
    assert.equal(sides.length, Number(folded[1]) * 2, 'Both sides of each sheet');
    for (const page of sides) assertPage(page, folded[2]!);
    assert.ok(
      sides.some((page) => page.text.includes('A spatial project brief')),
      'Source text stays text',
    );
    return { nUp: nUp.summary, booklet: booklet.summary };
  });

  await flow('Poster of an A1 page', async () => {
    await select(cases.poster, [posterSource]);
    await actions.palette('Lay out');
    const shown = await layoutReady('poster');
    assert.equal(shown.mode, 'Poster');
    assert.equal(shown.summary, '15 sheets of A4 landscape (3 × 5) · poster 594 × 841 mm');
    assert.equal(shown.name, 'Poster of Site plan');
    await capture('poster', '.layout-plane');
    const saved = await saveLayout('Save PDF');
    const pages = await checkPDF(saved.file);
    assert.equal(pages.length, 15);
    for (const page of pages) assertPage(page, 'A4 landscape');
    assert.ok(pages[0]!.text.includes('Site plan'), 'Source text stays text');
    assert.equal(pages[0]!.images, 0, 'The page is placed as vector');
    return { summary: shown.summary };
  });

  await flow('Nesting of 4 DXF parts', async () => {
    await select(cases.parts, partSources);
    assert.ok(await evaluate(pageCall(openContextMenu, partSources[0]!)));
    const suggested = await until(
      () => evaluate(pageCall(suggestedRows)),
      (rows) => rows.length > 0,
      'Suggested rows',
    );
    assert.ok(
      suggested.some((row) => row.includes('Nest for cutting…') && row.includes('4 DXF parts')),
      JSON.stringify(suggested),
    );
    await actions.click('.context-menu [data-menu-id="menu.Files"]');
    await actions.click('.context-submenu [data-menu-id="nest-parts"]');
    await until(
      () => evaluate(pageCall(nestingState)),
      (value) => value.quantities.length === 4,
      'Parts read by the parts worker',
      30_000,
    );
    const headings = new Set<string>();
    const watch = (value: ReturnType<typeof nestingState>) => {
      if (value.heading) headings.add(value.heading);
      return value;
    };
    const quantity = 'Quantity of Bracket with holes';
    const initial = (await evaluate(pageCall(nestingState))).quantities.find(
      (item) => item.part === 'Bracket with holes',
    )!;
    const wanted = String(Number(initial.value) + 5);
    await actions.field(quantity, wanted);
    const estimate = await until(
      async () => watch(await evaluate(pageCall(nestingState))),
      (value) => value.heading.startsWith('About '),
      'Boxes estimate',
    ).catch(() => undefined);
    const nested = await until(
      async () => watch(await evaluate(pageCall(nestingState))),
      (value) => value.status.includes('Checked:') || value.problems.length > 0,
      'Checked nesting from the nest worker',
      90_000,
    );
    assert.deepEqual(nested.problems, []);
    const result = /^(\d+) sheets? · 1250 × 2500 mm$/.exec(nested.heading);
    assert.ok(result, nested.heading);
    assert.match(nested.status, /Checked: parts at least [\d.,]+ mm apart, inside the margin\./);
    const total = nested.quantities.reduce((sum, item) => sum + Number(item.value), 0);
    await capture('nesting', '.layout-plane');
    const before = new Set((await jobs()).map((job) => job.id));
    await actions.button('Save nesting', '.nesting-panel');
    const saved = await until(
      () => evaluate(pageCall(nestingState)),
      (value) => value.saved.startsWith('Saved') || /failed|cancelled/.test(value.saved),
      'Saved nesting',
      120_000,
    );
    assert.match(saved.saved, /^Saved Nesting of 4 parts\.Open folder$/);
    const job = (await jobs()).find((item) => !before.has(item.id))!;
    assert.equal(job.status, 'completed', JSON.stringify(job.errors));
    const output = job.completed[0]!.destination!;
    assert.equal(output, path.join(parts, 'Nesting of 4 parts'));
    const sheets = Number(result[1]);
    const written = (await readdir(output)).sort();
    assert.deepEqual(
      written,
      [
        ...Array.from({ length: sheets }, (_, index) => `Sheet ${index + 1}.dxf`),
        'Parts.csv',
        'Report.pdf',
      ].sort(),
    );
    const entities: number[] = [];
    for (let index = 1; index <= sheets; index++) {
      const parsed = new DxfParser().parseSync(
        await readFile(path.join(output, `Sheet ${index}.dxf`), 'utf8'),
      );
      assert.ok(parsed && parsed.entities.length > 0, `Sheet ${index}.dxf has entities`);
      entities.push(parsed.entities.length);
    }
    const csv = (await readFile(path.join(output, 'Parts.csv'), 'utf8')).replace(/^﻿/, '');
    const [partTable, sheetTable] = csv.trimEnd().split('\r\n\r\n');
    const partRows = partTable!.split('\r\n').slice(1);
    assert.deepEqual(
      partRows.map((row) => row.split(',')[1]).sort(),
      [...partNames].sort(),
      'One row per part',
    );
    const bracket = partRows.find((row) => row.split(',')[1] === 'Bracket with holes')!.split(',');
    assert.deepEqual([bracket[3], bracket[4]], [wanted, wanted], 'Requested and placed');
    assert.equal(
      partRows.reduce((sum, row) => sum + Number(row.split(',')[4]), 0),
      total,
      'Every part placed',
    );
    assert.equal(sheetTable!.split('\r\n').length - 1, sheets, 'One row per sheet');
    const report = await checkPDF(path.join(output, 'Report.pdf'));
    assert.ok(report.length >= 1);
    assert.ok(report[0]!.text.includes('Nesting of 4 parts'), 'Report title');
    const undo = await undoRefused(job, output);
    await actions.button('Open folder', '.nesting-panel');
    await until(
      () =>
        evaluate(
          pageCall(
            (sheet: string) =>
              [...document.querySelectorAll<HTMLElement>('[data-file-path]')].some(
                (row) => row.dataset.filePath === sheet,
              ),
            path.join(output, 'Sheet 1.dxf'),
          ),
        ),
      Boolean,
      'Open folder lists the sheets',
    );
    return {
      estimate: estimate?.heading,
      headings: [...headings],
      status: nested.status,
      written,
      entities,
      undo,
    };
  });

  await flow('Save an attachment of Field trip.eml', async () => {
    await select(cases.mail, [messageSource]);
    await actions.key(' ', 'Space');
    const shown = await until(
      () => evaluate(pageCall(mailState)),
      (value) => value.attachments.length > 0 || !!value.error,
      'Attachments listed',
      30_000,
    );
    assert.equal(shown.error, '');
    assert.ok(shown.attachments.includes('Packing list.txt'), JSON.stringify(shown.attachments));
    const before = new Set((await jobs()).map((job) => job.id));
    await actions.click('.quick-preview [aria-label="Save Packing list.txt"]');
    const job = await until(
      jobs,
      (list) =>
        list.some(
          (job) => !before.has(job.id) && job.status !== 'running' && job.status !== 'queued',
        ),
      'Attachment saved',
      30_000,
    ).then((list) => list.find((job) => !before.has(job.id))!);
    assert.equal(job.status, 'completed', JSON.stringify(job.errors));
    const saved = job.completed[0]!.destination!;
    assert.equal(saved, path.join(mail, 'Packing list.txt'));
    assert.deepEqual(
      await readFile(saved),
      mimePart(message, "filename*=utf-8''Packing%20list.txt"),
      'The decoded part',
    );
    const mark = await quarantine(saved);
    assert.ok(mark.length > 0, 'Quarantined');
    await capture('mail-attachment', '.quick-preview-dialog');
    await actions.key('Escape', 'Escape');
    await until(
      () => evaluate(exists('.quick-preview')),
      (open) => !open,
      'Quick Preview closes',
    );
    return { attachments: shown.attachments, quarantine: mark };
  });

  await flow('Save All on a mailbox message', async () => {
    await select(cases.mailbox, [mailboxSource]);
    await actions.key(' ', 'Space');
    const listed = await until(
      () => evaluate(pageCall(mailState)),
      (value) => value.messages > 0 || !!value.error,
      'Mailbox listed',
      30_000,
    );
    assert.equal(listed.error, '');
    await evaluate(pageCall(chooseMessage, listed.messages - 1));
    const shown = await until(
      () => evaluate(pageCall(mailState)),
      (value) => value.attachments.length > 1,
      'Attachments of the last message',
      30_000,
    );
    const before = new Set((await jobs()).map((job) => job.id));
    await actions.button('Save All', '.quick-preview .mail-attachments-all');
    const saved = await until(
      jobs,
      (list) =>
        list.filter((job) => !before.has(job.id) && job.status === 'completed').length ===
          shown.attachments.length ||
        list.some((job) => !before.has(job.id) && job.status === 'failed'),
      'All attachments saved',
      30_000,
    ).then((list) => list.filter((job) => !before.has(job.id)));
    for (const job of saved) assert.equal(job.status, 'completed', JSON.stringify(job.errors));
    const written = saved.map((job) => job.completed[0]!.destination!).sort();
    assert.deepEqual(
      written,
      Object.keys(attached)
        .map((name) => path.join(mailbox, name))
        .sort(),
    );
    for (const [name, bytes] of Object.entries(attached)) {
      assert.deepEqual(await readFile(path.join(mailbox, name)), bytes, name);
      assert.ok((await quarantine(path.join(mailbox, name))).length > 0, 'Quarantined ' + name);
    }
    await capture('mailbox-attachments', '.quick-preview-dialog');
    await actions.key('Escape', 'Escape');
    return { messages: listed.messages, attachments: shown.attachments };
  });

  await flow('Open linked plane on a Pages package', async () => {
    await select(cases.package, [packageSource]);
    await actions.key(' ', 'Space');
    await until(
      () => evaluate(exists('.quick-preview [data-preview-module="embedded"]')),
      Boolean,
      'Saved preview in Quick Preview',
      30_000,
    );
    await actions.button('Open linked plane', '.quick-preview-dialog');
    const footers: string[] = [];
    const final = await until(
      async () => {
        const footer = await evaluate(pageCall(previewFooter));
        if (footer && footers.at(-1) !== footer) footers.push(footer);
        return footer;
      },
      (footer) => !!footer && !footer.includes('Calculating…'),
      'Package size',
      30_000,
    );
    await until(
      () => evaluate(exists('.preview-plane [data-preview-module="embedded"] img')),
      Boolean,
      'Saved preview in its plane',
    );
    const expected = formatBytes(await packageBytes(packageSource));
    assert.ok(final.endsWith(expected), `${final} shows ${expected}`);
    assert.ok(final.includes('Pages document') || final.includes('·'), final);
    await capture('package-plane', '.preview-plane');
    return { footers, expected };
  });
  await evaluate(animationFrames(1));
  assert.equal(await evaluate(exists('.notice')), false, 'No error left showing');
} finally {
  await app.close(connection);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ root, checks, screenshots, consoleProblems }, null, 2),
    { flag: 'wx' },
  );
  console.log('Screenshots:\n' + screenshots.join('\n'));
  if (consoleProblems.length) console.log('Console problems:\n' + consoleProblems.join('\n'));
  console.log('Retained layout acceptance:', root);
}
const failed = checks.filter((check) => !check.passed);
console.log(`${checks.length - failed.length} of ${checks.length} flows passed.`);
assert.deepEqual(
  failed.map((check) => check.flow),
  [],
);
