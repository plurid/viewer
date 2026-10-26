import SSF from '../../../assets/vendor/ssf-0.11.2.mjs';
import { attribute, child, children, type XMLNode } from './office-xml';
import type { WorkbookCell } from '../../domain/previews/documents/office';

export type CellFormatter = (
  raw: string,
  type: string,
  style: string | undefined,
) => Pick<WorkbookCell, 'formatted' | 'numberFormat' | 'formatWarning'>;
/** Formatting never changes stored values, formulas or evidence. SSF runs only in
 * the existing bounded document worker; no workbook style mutates its global table. */
export function workbookFormatter(styles: XMLNode | undefined, date1904: boolean): CellFormatter {
  const formats = new Map<number, string>();
  let limited = false;
  const custom = styles && child(styles, 'numFmts');
  for (const node of custom ? children(custom, 'numFmt') : []) {
    const id = Number(attribute(node, 'numFmtId')),
      code = attribute(node, 'formatCode') ?? '';
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      id > 65535 ||
      !code ||
      code.length > 256 ||
      formats.size >= 1024
    ) {
      limited = true;
      continue;
    }
    if (formats.has(id)) throw new Error('Duplicate workbook number format.');
    formats.set(id, code);
  }
  const base = styles && child(styles, 'cellStyleXfs'),
    source = styles && child(styles, 'cellXfs');
  const bases = (base ? children(base, 'xf') : []).slice(0, 4096);
  const definitions = source ? children(source, 'xf') : [];
  if (definitions.length > 4096) limited = true;
  const cellFormats = definitions.slice(0, 4096).map((node) => {
    const parent = bases[Number(attribute(node, 'xfId') ?? 0)];
    const useParent = ['0', 'false'].includes(attribute(node, 'applyNumberFormat') ?? '');
    return Number(
      (useParent ? undefined : attribute(node, 'numFmtId')) ??
        (parent && attribute(parent, 'numFmtId')) ??
        0,
    );
  });
  const builtin = SSF.get_table();
  return (raw, type, style) => {
    if (type !== 'n' || !raw) return {};
    const index = Number(style ?? 0),
      id = cellFormats[index] ?? (index === 0 ? 0 : undefined);
    const fallback = 'Unsupported number format; stored value shown.';
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= 4096 ||
      id === undefined ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      id > 65535
    )
      return { formatWarning: fallback };
    const code = formats.get(id) ?? builtin[id];
    if (id === 0 && !formats.has(0)) return {};
    // SSF also supplies known accounting/default aliases for built-in IDs.
    const format = code ?? (id < 82 ? id : undefined);
    if (
      format === undefined ||
      (typeof format === 'string' && /\[(?:DBNum|NatNum|\$[^\]]*-)/i.test(format))
    )
      return { numberFormat: code, formatWarning: fallback };
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw) ||
      !Number.isFinite(Number(raw))
    )
      return {
        numberFormat: code,
        formatWarning: 'This stored numeric value cannot be formatted.',
      };
    try {
      const value = SSF.format(format, Number(raw), { date1904 });
      if (value.length > 2048) return { numberFormat: code, formatWarning: fallback };
      return {
        formatted: value,
        numberFormat: code ?? String(id),
        ...(limited ? { formatWarning: 'Some workbook formats exceed the preview limits.' } : {}),
      };
    } catch {
      return { numberFormat: code, formatWarning: fallback };
    }
  };
}
