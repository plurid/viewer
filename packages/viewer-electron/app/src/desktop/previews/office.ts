import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { Archives } from './archives';
import { fileCoordination } from '../files/file-coordination';
import { attribute, child, children, localName, officeXML, xmlText } from './office-xml';
import { worksheetReader, type WorkbookBudget, type WorksheetReadWindow } from './office-worksheet';
import { workbookFormatter } from './office-formatting';
import type { XMLNode } from './office-xml';
import type { DocumentData } from '../../domain/services';
import type {
  WorkbookSheet,
  WorksheetWindow,
  WorksheetPage,
} from '../../domain/previews/documents/office';
import { worksheetPageSchema, columnName } from '../../domain/previews/documents/office';

import { typeIs, partTarget, relationships } from './office-package';
import { wordContent } from './office-word';
import {
  officeContentTypes,
  officeFamily,
  readsOfficeContent,
} from '../../domain/previews/documents/layout';

function richText(node: XMLNode): string {
  return children(node)
    .map((part) =>
      localName(part) === 't'
        ? xmlText(part)
        : localName(part) === 'r'
          ? children(part, 't').map(xmlText).join('')
          : '',
    )
    .join('');
}
/** Caller holds native read coordination. No package part is written or executed. */
export async function extractOffice(
  file: string,
  signal?: AbortSignal,
  requested?: WorksheetWindow,
  format = path.extname(file).slice(1).toLowerCase(),
): Promise<DocumentData> {
  const window = requested ? worksheetPageSchema.parse(requested) : undefined;
  if (!readsOfficeContent(format)) throw new Error('This Office format has no readable package.');
  const word = officeFamily(format) === 'word';
  if (window && word) throw new Error('Worksheet pages are available for Excel workbooks only.');
  const before = await lstat(fileCoordination.path(file));
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64000000)
    throw new Error('Office file must be a regular file within 64 MB.');
  const reader = new Archives();
  const result: DocumentData = {
    path: file,
    metadata: {},
    evidence: [],
    text: '',
    truncated: false,
  };
  try {
    const listing = await reader.list(file);
    if (listing.truncated) throw new Error('Office package index exceeds the reader limit.');
    const entries = new Map(listing.entries.map((item) => [item.name, item]));
    if (entries.size !== listing.entries.length)
      throw new Error('Office package has duplicate part names.');
    let bytes = 0;
    const reserve = (name: string, maximum: number) => {
      signal?.throwIfAborted();
      const item = entries.get(name);
      if (!item || item.directory || !item.previewable)
        throw new Error('Missing, encrypted, or unsupported Office part: ' + name);
      bytes += item.size;
      if (item.size > maximum || bytes > 32000000)
        throw new Error('Office expanded content exceeds the reader limit.');
    };
    const read = async (name: string) => {
      reserve(name, 4000000);
      const node = officeXML(await reader.read(file, name));
      signal?.throwIfAborted();
      return node;
    };
    const rootRelations = relationships(await read('_rels/.rels'));
    const mainRelations = rootRelations.filter((item) => typeIs(item.type, 'officeDocument'));
    const [mainRelation] = mainRelations;
    if (mainRelations.length !== 1 || !mainRelation || mainRelation.external)
      throw new Error('Office package has no local main document.');
    const mainPath = partTarget('', mainRelation.target);
    const types = await read('[Content_Types].xml');
    const contentType = children(types, 'Override').find(
      (node) => partTarget('', attribute(node, 'PartName') || '') === mainPath,
    );
    if (!contentType || attribute(contentType, 'ContentType') !== officeContentTypes[format])
      throw new Error('Office package type does not match this document.');
    const core = rootRelations.find(
      (item) =>
        item.type ===
          'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties' &&
        !item.external,
    );
    if (core) {
      const properties = await read(partTarget('', core.target));
      for (const key of ['title', 'creator', 'subject', 'description', 'created', 'modified']) {
        const value = child(properties, key);
        if (value) {
          result.metadata[key] = xmlText(value).slice(0, 10000);
          result.evidence.push({ source: 'metadata:' + key, text: result.metadata[key] });
        }
      }
    }
    const main = await read(mainPath);
    if (word) {
      const relPath = path.posix.join(
        path.posix.dirname(mainPath),
        '_rels',
        path.posix.basename(mainPath) + '.rels',
      );
      const rels = entries.has(relPath) ? relationships(await read(relPath)) : [];
      const parsed = wordContent(main, mainPath, rels, entries, types);
      result.office = parsed.content;
      result.truncated = parsed.truncated;
      result.coverageReason =
        'Document body text, tables and embedded PNG/JPEG images in source order. Page layout, floating-image positioning, unsupported drawings, merged table cells, headers, footers, footnotes and tracked deletions are omitted. External images are not loaded.';
      if (parsed.content.kind === 'word')
        for (const [block, item] of parsed.content.blocks.entries()) {
          const text =
            item.kind === 'paragraph'
              ? item.text
              : item.rows.map((row) => row.join('\t')).join('\n');
          result.evidence.push({
            source: 'document block ' + (block + 1),
            text,
            anchor: { kind: 'document', block },
          });
        }
    } else {
      if (localName(main) !== 'workbook') throw new Error('This XLSX has no readable workbook.');
      const relPath = path.posix.join(
        path.posix.dirname(mainPath),
        '_rels',
        path.posix.basename(mainPath) + '.rels',
      );
      const rels = relationships(await read(relPath));
      const styleRelation = rels.find((item) => typeIs(item.type, 'styles') && !item.external);
      const stylePart = styleRelation
        ? await read(partTarget(mainPath, styleRelation.target))
        : undefined;
      const workbookProperties = child(main, 'workbookPr');
      const date1904 = ['1', 'true'].includes(
        workbookProperties ? (attribute(workbookProperties, 'date1904') ?? '') : '',
      );
      const format = workbookFormatter(stylePart, date1904);
      const shared = rels.find((item) => typeIs(item.type, 'sharedStrings') && !item.external);
      const strings = shared
        ? children(await read(partTarget(mainPath, shared.target)), 'si').map(richText)
        : [];
      const sheetContainer = child(main, 'sheets');
      const definitions = sheetContainer ? children(sheetContainer, 'sheet') : [];
      if (!definitions.length) throw new Error('This XLSX has no worksheets.');
      if (definitions.length > 32) result.truncated = true;
      const supported = (node: XMLNode) => {
        const relation = rels.find((item) => item.id === attribute(node, 'id'));
        return relation && typeIs(relation.type, 'worksheet') && !relation.external;
      };
      const selected = window
        ? window.sheet
          ? definitions.find((node) => attribute(node, 'name') === window.sheet)
          : definitions
              .slice(0, 32)
              .find(
                (node) =>
                  supported(node) &&
                  !['hidden', 'veryHidden'].includes(attribute(node, 'state') || ''),
              ) || definitions.slice(0, 32).find(supported)
        : undefined;
      if (
        window &&
        (!selected || !supported(selected) || !definitions.slice(0, 32).includes(selected))
      )
        throw new Error('The requested worksheet is unavailable in this workbook.');
      const sheets: WorkbookSheet[] = [];
      let page: WorksheetPage | undefined;
      const budget: WorkbookBudget = {
        formulas: 0,
        missingCached: 0,
        cells: 0,
        characters: 0,
        truncated: false,
      };
      const names = new Set<string>();
      for (const definition of definitions.slice(0, 32)) {
        const name = attribute(definition, 'name') || '';
        if (!name || name.length > 200 || names.has(name))
          throw new Error('Invalid or duplicate worksheet name.');
        names.add(name);
        const relation = rels.find((item) => item.id === attribute(definition, 'id'));
        if (!relation || !typeIs(relation.type, 'worksheet') || relation.external) {
          result.truncated = true;
          continue;
        }
        const sheet: WorkbookSheet = {
          name,
          hidden: ['hidden', 'veryHidden'].includes(attribute(definition, 'state') || ''),
          rows: [],
          columns: 1,
          truncated: false,
          ...(window ? { loaded: definition === selected } : {}),
        };
        if (window && definition !== selected) {
          sheets.push(sheet);
          continue;
        }
        const part = partTarget(mainPath, relation.target);
        reserve(part, 32000000);
        const range: WorksheetReadWindow | undefined = window
          ? { fromRow: window.fromRow, limit: window.limit }
          : undefined;
        const parser = worksheetReader(sheet, strings, budget, result.evidence, range, format);
        await reader.readZIPChunks(file, part, (chunk) => parser.write(chunk), signal);
        parser.end();
        const anchors = new Set<string>();
        for (const merge of sheet.merges ?? []) {
          const value = sheet.rows
            .find((row) => row.row === merge.fromRow)
            ?.cells.find((cell) => cell.column === merge.fromColumn);
          if (value) merge.anchor = value;
          else if (sheet.rows.some((row) => row.row >= merge.fromRow && row.row <= merge.toRow))
            anchors.add(columnName(merge.fromColumn) + merge.fromRow);
        }
        if (anchors.size) {
          const anchorSheet: WorkbookSheet = {
            name,
            hidden: sheet.hidden,
            rows: [],
            columns: 1,
            truncated: false,
          };
          const anchorBudget: WorkbookBudget = {
            cells: 0,
            characters: 0,
            formulas: 0,
            missingCached: 0,
            truncated: false,
          };
          const anchorParser = worksheetReader(
            anchorSheet,
            strings,
            anchorBudget,
            [],
            undefined,
            format,
            anchors,
          );
          await reader.readZIPChunks(file, part, (chunk) => anchorParser.write(chunk), signal);
          anchorParser.end();
          sheet.mergeLimited ||= anchorSheet.truncated || anchorBudget.truncated;
          for (const merge of sheet.merges ?? [])
            if (!merge.anchor)
              merge.anchor = anchorSheet.rows
                .find((row) => row.row === merge.fromRow)
                ?.cells.find((cell) => cell.column === merge.fromColumn) ?? {
                column: merge.fromColumn,
                value: '',
                ...(sheet.mergeLimited
                  ? { formatWarning: 'The merged anchor exceeds the preview read limit.' }
                  : {}),
              };
        }
        if (range)
          page = {
            sheet: name,
            fromRow: range.fromRow,
            lastRow: range.lastRow ?? 0,
            nextRow: range.nextRow,
            limited: sheet.truncated,
          };
        if (sheet.truncated) result.truncated = true;
        sheets.push(sheet);
      }
      if (!sheets.length || (window && !page))
        throw new Error('The requested worksheet has no supported local content.');
      result.truncated ||= budget.truncated;
      if (page && (page.fromRow > 1 || page.nextRow || sheets.length > 1)) result.truncated = true;
      result.office = {
        kind: 'workbook',
        sheets,
        formulas: budget.formulas,
        missingCached: budget.missingCached,
        ...(page ? { page } : {}),
      };
      result.coverageReason =
        'Saved cell values with bounded number/date formats and merged ranges. Stored values and formulas remain inspectable; formulas are not recalculated. Conditional formatting, source fonts/colors, charts, drawings and external data are omitted.';
    }
    const after = await lstat(fileCoordination.path(file));
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('Office document changed while being read. Open it again.');
    signal?.throwIfAborted();
    result.text = result.evidence
      .map((item) => '[' + item.source + ']\n' + item.text)
      .join('\n\n')
      .slice(0, 150000);
    return result;
  } finally {
    reader.release(file);
  }
}
