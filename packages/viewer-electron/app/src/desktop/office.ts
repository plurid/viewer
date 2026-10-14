import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { Archives } from './archives';
import { fileCoordination } from './file-coordination';
import { attribute, child, children, localName, officeXML, xmlText } from './office-xml';
import type { XMLNode } from './office-xml';
import type { DocumentData } from '../domain/services';
import type {
  OfficeContent,
  WorkbookRow,
  WorkbookSheet,
  WordParagraph,
  WordTable,
} from '../domain/office';
import { columnName } from '../domain/office';

const relationshipTypes = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/',
];
const typeIs = (type: string, name: string) =>
  relationshipTypes.some((prefix) => type === prefix + name);
interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}
/** OPC targets are package paths, never filesystem paths or fetchable URLs. */
function partTarget(source: string, target: string): string {
  const decoded = decodeURIComponent(target);
  if (
    !decoded ||
    decoded.length > 1000 ||
    /[\\\u0000-\u001f?#]/.test(decoded) ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded)
  )
    throw new Error('Invalid Office package relationship target.');
  const stack = decoded.startsWith('/')
    ? []
    : path.posix
        .dirname(source)
        .split('/')
        .filter((part) => part !== '.');
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) throw new Error('Office relationship escapes its package.');
      stack.pop();
    } else stack.push(part);
  }
  return stack.join('/');
}
function relationships(root: XMLNode): Relationship[] {
  if (localName(root) !== 'Relationships') throw new Error('Malformed Office relationships.');
  const ids = new Set<string>();
  return children(root, 'Relationship').map((node) => {
    const id = attribute(node, 'Id') || '',
      type = attribute(node, 'Type') || '',
      target = attribute(node, 'Target') || '';
    if (!id || ids.has(id) || !type || !target)
      throw new Error('Malformed or duplicate Office relationship.');
    ids.add(id);
    return { id, type, target, external: attribute(node, 'TargetMode') === 'External' };
  });
}
function wordText(node: XMLNode): string {
  const name = localName(node);
  if (['del', 'moveFrom', 'instrText', 'drawing', 'pict', 'object'].includes(name)) return '';
  if (name === 't') return xmlText(node);
  if (name === 'tab') return '\t';
  if (name === 'br' || name === 'cr') return '\n';
  return children(node).map(wordText).join('');
}
function wordParagraphs(node: XMLNode): XMLNode[] {
  if (['del', 'moveFrom'].includes(localName(node))) return [];
  if (localName(node) === 'p') return [node];
  return children(node).flatMap(wordParagraphs);
}
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
function wordContent(main: XMLNode): { content: OfficeContent; truncated: boolean } {
  const body = child(main, 'body');
  if (localName(main) !== 'document' || !body)
    throw new Error('This DOCX has no readable document body.');
  const blocks: (WordParagraph | WordTable)[] = [];
  let characters = 0,
    tableCells = 0,
    truncated = false;
  const text = (node: XMLNode) => {
    const value = wordText(node);
    const bounded = value.slice(0, Math.max(0, 500000 - characters));
    characters += bounded.length;
    if (bounded.length < value.length) truncated = true;
    return bounded;
  };
  const visit = (node: XMLNode) => {
    if (blocks.length >= 2000 || characters >= 500000) {
      truncated = true;
      return;
    }
    const name = localName(node);
    if (name === 'del' || name === 'moveFrom') return;
    if (name === 'p') {
      const value = text(node);
      const properties = child(node, 'pPr');
      const outline = properties && child(properties, 'outlineLvl');
      const style = properties && child(properties, 'pStyle');
      const level = outline
        ? Number(attribute(outline, 'val')) + 1
        : Number(style && attribute(style, 'val')?.match(/^Heading([1-6])$/i)?.[1]);
      blocks.push({
        kind: 'paragraph',
        text: value,
        ...(level >= 1 && level <= 6 ? { heading: level } : {}),
      });
    } else if (name === 'tbl') {
      const rows = children(node, 'tr');
      if (rows.length > 500) truncated = true;
      blocks.push({
        kind: 'table',
        rows: rows.slice(0, 500).map((row) => {
          const cells = children(row, 'tc');
          if (cells.length > 100) truncated = true;
          if (tableCells + cells.length > 10000) truncated = true;
          const retained = cells.slice(0, Math.min(100, Math.max(0, 10000 - tableCells)));
          tableCells += retained.length;
          return retained.map((cell) => wordParagraphs(cell).map(text).join('\n'));
        }),
      });
    } else for (const nested of children(node)) visit(nested);
  };
  for (const node of children(body)) visit(node);
  return { content: { kind: 'word', blocks }, truncated };
}
function cellAddress(reference: string): { row: number; column: number } {
  const match = reference.match(/^([A-Z]{1,3})([1-9]\d{0,6})$/);
  if (!match) throw new Error('Invalid worksheet cell address.');
  const column = [...match[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0),
    row = Number(match[2]);
  if (row > 1048576 || column > 16384)
    throw new Error('Worksheet cell address exceeds Excel limits.');
  return { row, column };
}

/** Caller holds native read coordination. No package part is written or executed. */
export async function extractOffice(file: string, signal?: AbortSignal): Promise<DocumentData> {
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
    const read = async (name: string) => {
      signal?.throwIfAborted();
      const item = entries.get(name);
      if (!item || item.directory || !item.previewable)
        throw new Error('Missing, encrypted, or unsupported Office part: ' + name);
      bytes += item.size;
      if (item.size > 4000000 || bytes > 32000000)
        throw new Error('Office expanded content exceeds the reader limit.');
      const node = officeXML(await reader.read(file, name));
      signal?.throwIfAborted();
      return node;
    };
    const rootRelations = relationships(await read('_rels/.rels'));
    const mainRelations = rootRelations.filter((item) => typeIs(item.type, 'officeDocument'));
    if (mainRelations.length !== 1 || mainRelations[0].external)
      throw new Error('Office package has no local main document.');
    const mainPath = partTarget('', mainRelations[0].target);
    const types = await read('[Content_Types].xml');
    const expected =
      path.extname(file).toLowerCase() === '.docx'
        ? 'wordprocessingml.document.main+xml'
        : 'spreadsheetml.sheet.main+xml';
    const contentType = children(types, 'Override').find(
      (node) => partTarget('', attribute(node, 'PartName') || '') === mainPath,
    );
    if (
      !contentType ||
      attribute(contentType, 'ContentType') !==
        'application/vnd.openxmlformats-officedocument.' + expected
    )
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
    if (path.extname(file).toLowerCase() === '.docx') {
      const parsed = wordContent(main);
      result.office = parsed.content;
      result.truncated = parsed.truncated;
      result.coverageReason =
        'Document body text and tables. Page layout, images, merged table cells, headers, footers, footnotes and tracked deletions are omitted.';
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
      const shared = rels.find((item) => typeIs(item.type, 'sharedStrings') && !item.external);
      const strings = shared
        ? children(await read(partTarget(mainPath, shared.target)), 'si').map(richText)
        : [];
      const sheetContainer = child(main, 'sheets');
      const definitions = sheetContainer ? children(sheetContainer, 'sheet') : [];
      if (!definitions.length) throw new Error('This XLSX has no worksheets.');
      if (definitions.length > 32) result.truncated = true;
      const sheets: WorkbookSheet[] = [];
      let formulas = 0,
        missingCached = 0,
        cells = 0,
        characters = 0;
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
        const worksheet = await read(partTarget(mainPath, relation.target));
        if (localName(worksheet) !== 'worksheet') throw new Error('Invalid worksheet part.');
        const data = child(worksheet, 'sheetData');
        const sheet: WorkbookSheet = {
          name,
          hidden: ['hidden', 'veryHidden'].includes(attribute(definition, 'state') || ''),
          rows: [],
          columns: 1,
          truncated: false,
        };
        let previousRow = 0;
        for (const sourceRow of data ? children(data, 'row') : []) {
          signal?.throwIfAborted();
          const row = Number(attribute(sourceRow, 'r') || previousRow + 1);
          if (!Number.isSafeInteger(row) || row <= previousRow || row > 1048576)
            throw new Error('Invalid or unordered worksheet row.');
          previousRow = row;
          if (sheet.rows.length >= 2000 || cells >= 50000 || characters >= 500000) {
            sheet.truncated = true;
            break;
          }
          const output: WorkbookRow = { row, cells: [] };
          let previousColumn = 0;
          for (const node of children(sourceRow, 'c')) {
            const reference = attribute(node, 'r');
            const location = reference
              ? cellAddress(reference)
              : { row, column: previousColumn + 1 };
            if (location.row !== row || location.column <= previousColumn)
              throw new Error('Duplicate or unordered worksheet cell.');
            previousColumn = location.column;
            if (location.column > 256 || cells >= 50000 || characters >= 500000) {
              sheet.truncated = true;
              continue;
            }
            const raw = child(node, 'v'),
              formula = child(node, 'f');
            const type = attribute(node, 't') || 'n';
            let value = raw ? xmlText(raw) : '';
            if (type === 's') {
              const index = Number(value);
              if (
                !/^\d+$/.test(value) ||
                !Number.isSafeInteger(index) ||
                strings[index] === undefined
              )
                throw new Error('Worksheet references a missing shared string.');
              value = strings[index];
            } else if (type === 'inlineStr') {
              const inline = child(node, 'is');
              value = inline ? richText(inline) : '';
            } else if (type === 'b') {
              if (value && value !== '0' && value !== '1')
                throw new Error('Invalid worksheet boolean.');
              value = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : '';
            } else if (!['n', 'str', 'e', 'd'].includes(type)) {
              sheet.truncated = true;
              continue;
            }
            const bounded = value.slice(0, Math.min(10000, 500000 - characters));
            if (bounded.length < value.length) sheet.truncated = true;
            characters += bounded.length;
            cells++;
            if (formula) {
              formulas++;
              if (!raw) missingCached++;
            }
            const formulaText = formula ? xmlText(formula) : undefined;
            const boundedFormula = formulaText?.slice(0, Math.min(10000, 500000 - characters));
            if (formulaText !== boundedFormula) sheet.truncated = true;
            characters += boundedFormula?.length || 0;
            output.cells.push({
              column: location.column,
              value: bounded,
              ...(formula ? { formula: boundedFormula, cached: Boolean(raw) } : {}),
            });
            sheet.columns = Math.max(sheet.columns, location.column);
            if (bounded && result.evidence.length < 8000)
              result.evidence.push({
                source: name + '!' + columnName(location.column) + row,
                text: bounded,
                anchor: { kind: 'cells', sheet: name, row, column: location.column },
              });
            else if (bounded) result.truncated = true;
          }
          sheet.rows.push(output);
        }
        if (sheet.truncated) result.truncated = true;
        sheets.push(sheet);
      }
      if (!sheets.length) throw new Error('This workbook has no supported local worksheets.');
      result.office = { kind: 'workbook', sheets, formulas, missingCached };
      result.coverageReason =
        'Saved cell values; formulas are not recalculated. Number/date formatting, merged cells, charts, drawings and external data are omitted.';
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
