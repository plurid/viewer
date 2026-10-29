import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Archives } from './archives';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { DocumentData } from '../../domain/services';
import { fileCoordination } from '../files/file-coordination';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import { epubReference, epubImagePath, epubImageLimit } from '../../domain/previews/documents/epub';
import { readsOfficeContent } from '../../domain/previews/documents/layout';
const run = promisify(execFile);
const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, value) => String.fromCodePoint(Math.min(0x10ffff, Number(value))));
const plainText = (html: string) =>
  decode(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(?:p|h[1-6]|li|div)>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[\t ]+/g, ' ')
    .trim();
/** Caller must hold a read coordination claim for this file. */
export async function documentBytes(file: string, limit: number): Promise<Uint8Array> {
  const handle = await open(
    fileCoordination.path(file),
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit)
      throw new Error('Document is not a regular file within the extraction limit.');
    const data = new Uint8Array(info.size);
    let offset = 0;
    while (offset < data.length) {
      const result = await handle.read(data, offset, data.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    return data.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
export async function extractDocument(
  file: string,
  options: { ocr?: string; pages?: number; signal?: AbortSignal; worksheet?: WorksheetWindow } = {},
): Promise<DocumentData> {
  return fileCoordination.run(
    [{ path: file, mode: 'read' }],
    async (signal) => {
      signal?.throwIfAborted();
      const result = await extractCoordinated(file, { ...options, signal });
      signal?.throwIfAborted();
      return result;
    },
    options.signal,
  );
}
async function extractCoordinated(
  file: string,
  options: { ocr?: string; pages?: number; signal?: AbortSignal; worksheet?: WorksheetWindow },
): Promise<DocumentData> {
  const extension = path.extname(file).toLowerCase();
  if (options.worksheet && extension !== '.xlsx')
    throw new Error('Worksheet pages are available for XLSX files only.');
  const result: DocumentData = {
    path: file,
    metadata: {},
    evidence: [],
    text: '',
    truncated: false,
  };
  if (readsOfficeContent(extension.slice(1))) {
    const { extractOffice } = await import('./office');
    return extractOffice(file, options.signal, options.worksheet);
  } else if (extension === '.pdf') {
    const [pdf, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]);
    // Extraction already runs in a utility process; supply PDF.js's in-process handler
    // so its fake-worker path does not try to resolve an unbundled package file.
    (globalThis as unknown as { pdfjsWorker: typeof worker }).pdfjsWorker = worker;
    let pdfRoot: string;
    try {
      pdfRoot = path.dirname(
        createRequire(typeof __filename === 'string' ? __filename : import.meta.url).resolve(
          'pdfjs-dist/package.json',
        ),
      );
    } catch {
      // Bundled test/embedded hosts may supply only the renderer's PDF assets.
      const directory =
        typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
      pdfRoot = path.join(directory, '../renderer/main_window/pdfjs');
    }
    const parameters = {
      data: await documentBytes(file, 64000000),
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      standardFontDataUrl: pdfRoot + '/standard_fonts/',
      cMapUrl: pdfRoot + '/cmaps/',
      cMapPacked: true,
    };
    const task = pdf.getDocument(parameters);
    const cancel = () => {
      void task.destroy();
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      options.signal?.throwIfAborted();
      const document = await task.promise;
      const metadata = await document.getMetadata();
      for (const [key, value] of Object.entries(metadata.info))
        if (typeof value === 'string' && value.trim()) {
          result.metadata[key.toLowerCase()] = value;
          result.evidence.push({ source: 'metadata:' + key.toLowerCase(), text: value });
        }
      const pages = Math.min(document.numPages, options.pages ?? 16, 64);
      result.metadata.pages = String(document.numPages);
      result.truncated = pages < document.numPages;
      for (let i = 1; i <= pages; i++) {
        options.signal?.throwIfAborted();
        const page = await document.getPage(i);
        const text = (await page.getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        if (text.trim())
          result.evidence.push({
            source: 'page ' + i,
            text: text.slice(0, 20000),
            anchor: { kind: 'pdf', page: i },
          });
        if (text.length > 20000) result.truncated = true;
        page.cleanup();
      }
      if (
        result.evidence
          .filter((item) => item.source.startsWith('page'))
          .reduce((size, item) => size + item.text.length, 0) < 100 &&
        options.ocr
      ) {
        // A subprocess does not inherit folder grants acquired later through
        // PowerBox. Read in the authorized process and send bounded PDF bytes.
        const input = await documentBytes(file, 64000000);
        const pending = run(options.ocr, ['-', String(pages)], {
          timeout: 90000,
          maxBuffer: 2000000,
          signal: options.signal,
        });
        pending.child.stdin?.on('error', () => {}); // execFile reports early exit/abort.
        pending.child.stdin?.end(Buffer.from(input));
        const output = await pending;
        const records: unknown = JSON.parse(output.stdout);
        if (Array.isArray(records))
          for (const record of records)
            if (
              record &&
              typeof record === 'object' &&
              typeof record.page === 'number' &&
              typeof record.text === 'string'
            )
              result.evidence.push({
                source: 'OCR page ' + record.page,
                text: record.text.slice(0, 20000),
                anchor: { kind: 'pdf', page: record.page },
              });
      }
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      await task.destroy();
    }
  } else if (extension === '.epub') {
    await verifyDocument(file);
    const reader = new Archives();
    const listing = await reader.list(file);
    const files = listing.entries.filter((item) => /\.(xml|opf|xhtml|html|htm)$/i.test(item.name));
    if (
      listing.truncated ||
      files.some((item) => !item.previewable || item.size > 4000000) ||
      files.reduce((n, item) => n + item.size, 0) > 32000000
    )
      throw new Error('EPUB expanded content exceeds its extraction limit.');
    const archive: Record<string, Uint8Array> = {};
    for (const item of files) {
      options.signal?.throwIfAborted();
      archive[item.name] = await reader.read(file, item.name);
    }
    reader.release(file);
    const strFromU8 = (value: Uint8Array) => new TextDecoder().decode(value);
    const container = strFromU8(archive['META-INF/container.xml'] || new Uint8Array());
    const opfPath = container.match(/full-path\s*=\s*["']([^"']+)["']/)?.[1];
    if (!opfPath || !archive[opfPath])
      throw new Error(
        'This EPUB has no readable publication metadata. Encrypted publications may require another reader.',
      );
    const opf = strFromU8(archive[opfPath]);
    if (/<!DOCTYPE|<!ENTITY/i.test(opf))
      throw new Error('External XML entities are not supported.');
    for (const key of ['title', 'creator', 'publisher', 'date', 'language', 'identifier']) {
      const values = Array.from(
        opf.matchAll(
          new RegExp('<(?:dc:)?' + key + '\\b[^>]*>([\\s\\S]*?)<\\/(?:dc:)?' + key + '>', 'gi'),
        ),
      ).map((item) => plainText(item[1] ?? ''));
      if (values.length) {
        result.metadata[key] = values.join('; ');
        result.evidence.push({ source: 'publication:' + key, text: result.metadata[key] });
      }
    }
    const attributes = (value: string) =>
      Object.fromEntries(
        Array.from(value.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)).map((match) => [
          match[1] ?? '',
          decode(match[2] ?? ''),
        ]),
      );
    const items = new Map(
      Array.from(opf.matchAll(/<item\b([^>]+)\/?\s*>/g)).map((match) => {
        const attr = attributes(match[1] ?? '');
        return [attr.id, attr.href];
      }),
    );
    const manifest = new Set(
      Array.from(items.values()).flatMap((href) => {
        const target = href && epubReference(opfPath, href);
        return target ? [target.path] : [];
      }),
    );
    result.epub = {
      images: listing.entries
        .filter(
          (item) =>
            manifest.has(item.name) &&
            epubImagePath(item.name) &&
            item.previewable &&
            item.size <= epubImageLimit,
        )
        .map((item) => ({ path: item.name, size: item.size })),
    };
    const spine = Array.from(opf.matchAll(/<itemref\b([^>]+)\/?\s*>/g));
    const ordered = [
      ...new Set([
        ...spine.flatMap((match) => {
          const href = items.get(attributes(match[1] ?? '').idref);
          return href
            ? [epubReference(opfPath, href)?.path].filter((part): part is string => !!part)
            : [];
        }),
        ...[...manifest].filter((part) => /\.(xhtml|html|htm)$/i.test(part)),
      ]),
    ];
    const chapters = ordered.slice(0, 300).flatMap((target) => {
      if (!target || !archive[target]) return [];
      const html = strFromU8(archive[target]);
      const text = plainText(html).slice(0, 30000);
      const title = plainText(
        html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ||
          html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
          'Chapter ' + (result.evidence.length + 1),
      );
      result.evidence.push({ source: 'chapter:' + title, text });
      if (html.length > 400000) result.truncated = true;
      return [{ title, path: target, html: html.slice(0, 400000) }];
    });
    result.chapters = chapters;
    let chapter = 0;
    for (const evidence of result.evidence)
      if (evidence.source.startsWith('chapter:'))
        evidence.anchor = { kind: 'epub', chapter: chapter++ };
    result.truncated ||= ordered.length > chapters.length || spine.length > chapters.length;
    if (result.truncated)
      result.coverageReason =
        'Some chapters or chapter content exceed the supported reading limits.';
  } else {
    const data = await documentBytes(file, 4000000);
    if (data.subarray(0, 8192).includes(0)) throw new Error('This format has no text extractor.');
    const text = new TextDecoder().decode(data);
    result.evidence.push({ source: 'text', text: text.slice(0, 150000) });
    result.truncated = text.length > 150000;
  }
  result.text = result.evidence
    .map((item) => '[' + item.source + ']\n' + item.text)
    .join('\n\n')
    .slice(0, 150000);
  return result;
}
function initials(value: string): string {
  return value
    .split(';')
    .map((author) => {
      const parts = author.trim().split(/\s+/);
      if (parts.length < 2 || parts.some((part) => /[^\p{L}.'’-]/u.test(part)))
        return author.trim();
      return (
        parts
          .slice(0, -1)
          .map((part) => (part.endsWith('.') ? part : part[0] + '.'))
          .join(' ') +
        ' ' +
        parts.at(-1)
      );
    })
    .join('; ');
}
export function localBookFields(document: DocumentData): Record<string, string> {
  const metadata = document.metadata;
  const year =
    metadata.date?.match(/^\d{4}(?:-\d{2}(?:-\d{2})?)?(?:T.*)?$/)?.[0]?.slice(0, 4) || '';
  return {
    year,
    authors: initials(metadata.creator || metadata.author || ''),
    title: metadata.title || '',
    publisher: metadata.publisher || '',
  };
}
async function verifyDocument(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Select a regular document.');
}
