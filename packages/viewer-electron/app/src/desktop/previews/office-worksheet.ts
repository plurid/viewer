import type { DocumentData } from '../../domain/services';
import type { WorkbookRow, WorkbookSheet } from '../../domain/previews/documents/office';
import { columnName } from '../../domain/previews/documents/office';
import { attribute, localName, OfficeXMLStream } from './office-xml';

export interface WorkbookBudget {
  cells: number;
  characters: number;
  formulas: number;
  missingCached: number;
  truncated: boolean;
}
interface Cell {
  column: number;
  type: string;
  raw: string;
  inline: string;
  formula: string;
  hasRaw: boolean;
  hasFormula: boolean;
  hasInline: boolean;
  rawOverflow: boolean;
}
function cellAddress(reference: string): { row: number; column: number } {
  const match = reference.match(/^([A-Z]{1,3})([1-9]\d{0,6})$/);
  if (!match) throw new Error('Invalid worksheet cell address.');
  const column = [...match[1]!].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0),
    row = Number(match[2]);
  if (row > 1048576 || column > 16384)
    throw new Error('Worksheet cell address exceeds Excel limits.');
  return { row, column };
}

/** Retains only bounded cell values, not a worksheet DOM. XML and ZIP validation
 * continue after output limits; ignored source suffixes cannot appear successful. */
export function worksheetReader(
  sheet: WorkbookSheet,
  strings: readonly string[],
  budget: WorkbookBudget,
  evidence: DocumentData['evidence'],
): OfficeXMLStream {
  const trail: string[] = [];
  let previousRow = 0,
    previousColumn = 0,
    rowNumber = 0;
  let row: WorkbookRow | undefined, cell: Cell | undefined;
  const retain = () => budget.cells < 50000 && budget.characters < 500000;
  const finishCell = () => {
    if (!cell || !row) return;
    let value = cell.raw;
    if (cell.type === 's') {
      const index = Number(value);
      if (
        cell.rawOverflow ||
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(index) ||
        strings[index] === undefined
      )
        throw new Error('Worksheet references a missing shared string.');
      value = strings[index]!;
    } else if (cell.type === 'inlineStr') value = cell.inline;
    else if (cell.type === 'b') {
      if (cell.rawOverflow || (value && value !== '0' && value !== '1'))
        throw new Error('Invalid worksheet boolean.');
      value = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : '';
    } else if (!['n', 'str', 'e', 'd'].includes(cell.type)) {
      sheet.truncated = true;
      return;
    }
    const bounded = value.slice(0, Math.min(10000, 500000 - budget.characters));
    if (bounded.length < value.length) sheet.truncated = true;
    budget.characters += bounded.length;
    const formula = cell.formula.slice(0, Math.min(10000, 500000 - budget.characters));
    if (formula.length < cell.formula.length) sheet.truncated = true;
    budget.characters += formula.length;
    budget.cells++;
    if (cell.hasFormula) {
      budget.formulas++;
      if (!cell.hasRaw) budget.missingCached++;
    }
    row.cells.push({
      column: cell.column,
      value: bounded,
      ...(cell.hasFormula ? { formula, cached: cell.hasRaw } : {}),
    });
    sheet.columns = Math.max(sheet.columns, cell.column);
    if (bounded && evidence.length < 8000)
      evidence.push({
        source: sheet.name + '!' + columnName(cell.column) + rowNumber,
        text: bounded,
        anchor: { kind: 'cells', sheet: sheet.name, row: rowNumber, column: cell.column },
      });
    else if (bounded) budget.truncated = true;
  };
  return new OfficeXMLStream(
    {
      open(node) {
        const name = localName(node);
        trail.push(name);
        if (trail.length === 1 && name !== 'worksheet') throw new Error('Invalid worksheet part.');
        if (trail[1] !== 'sheetData') return;
        if (trail.length === 3 && name === 'row') {
          rowNumber = Number(attribute(node, 'r') || previousRow + 1);
          if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRow || rowNumber > 1048576)
            throw new Error('Invalid or unordered worksheet row.');
          previousRow = rowNumber;
          previousColumn = 0;
          if (sheet.rows.length < 2000 && retain()) row = { row: rowNumber, cells: [] };
          else {
            row = undefined;
            sheet.truncated = true;
          }
        } else if (trail.length === 4 && trail[2] === 'row' && name === 'c') {
          const reference = attribute(node, 'r');
          const location = reference
            ? cellAddress(reference)
            : { row: rowNumber, column: previousColumn + 1 };
          if (
            location.row !== rowNumber ||
            location.column <= previousColumn ||
            location.column > 16384
          )
            throw new Error('Duplicate or unordered worksheet cell.');
          previousColumn = location.column;
          if (!row || location.column > 256 || !retain()) {
            cell = undefined;
            sheet.truncated = true;
          } else
            cell = {
              column: location.column,
              type: attribute(node, 't') || 'n',
              raw: '',
              inline: '',
              formula: '',
              hasRaw: false,
              hasFormula: false,
              hasInline: false,
              rawOverflow: false,
            };
        } else if (cell && trail.length === 5) {
          if (name === 'v') {
            if (cell.hasRaw) throw new Error('Duplicate worksheet cell value.');
            cell.hasRaw = true;
          }
          if (name === 'f') {
            if (cell.hasFormula) throw new Error('Duplicate worksheet formula.');
            cell.hasFormula = true;
          }
          if (name === 'is') {
            if (cell.hasInline) throw new Error('Duplicate worksheet inline value.');
            cell.hasInline = true;
          }
        }
      },
      text(value) {
        if (!cell) return;
        const field =
          trail[4] === 'v'
            ? 'raw'
            : trail[4] === 'f'
              ? 'formula'
              : trail[4] === 'is' && (trail[5] === 't' || (trail[5] === 'r' && trail[6] === 't'))
                ? 'inline'
                : undefined;
        if (!field) return;
        const available = 10000 - cell[field].length;
        if (value.length > available) {
          sheet.truncated = true;
          if (field === 'raw') cell.rawOverflow = true;
        }
        cell[field] += value.slice(0, available);
      },
      close(name) {
        if (
          trail.length === 4 &&
          trail[1] === 'sheetData' &&
          trail[2] === 'row' &&
          name.split(':').at(-1) === 'c'
        ) {
          finishCell();
          cell = undefined;
        }
        if (trail.length === 3 && trail[1] === 'sheetData' && name.split(':').at(-1) === 'row') {
          if (row) sheet.rows.push(row);
          row = undefined;
        }
        trail.pop();
      },
    },
    4000000,
  );
}
