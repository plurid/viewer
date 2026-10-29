import { isOfficeFormat, type OfficeFormat } from '../../domain/previews/documents/layout';

export interface OfficeRenderOptions {
  name?: string;
  sheet?: string;
  /** Every sheet of a workbook, for a saved PDF copy; a preview shows one at a time. */
  whole?: boolean;
}

interface OfficeRenderJob {
  extension: OfficeFormat;
  inputPath: string;
  inputURL: string;
  sheet?: string;
  whole?: true;
}

/** Preserve filename fields without passing host directories into the engine.
 * The filesystem path and its encoded file URL must identify the same RAM file. */
export function createOfficeJob(
  extension: string,
  options: OfficeRenderOptions = {},
): OfficeRenderJob {
  if (!isOfficeFormat(extension)) throw new Error('Unsupported Office format.');
  const name = options.name ?? `input.${extension}`;
  if (
    !name.length ||
    name.length > 1024 ||
    /[/\\\0]/.test(name) ||
    !name.toLowerCase().endsWith('.' + extension)
  )
    throw new Error('Invalid Office filename.');
  let encoded: string;
  try {
    encoded = encodeURIComponent(name);
  } catch {
    throw new Error('Invalid Office filename.');
  }
  const { sheet } = options;
  if (sheet !== undefined && (!sheet.length || sheet.length > 200 || sheet.includes('\0')))
    throw new Error('Invalid Office worksheet.');
  return {
    extension,
    inputPath: '/tmp/viewer-input/' + name,
    inputURL: 'file:///tmp/viewer-input/' + encoded,
    ...(sheet === undefined ? {} : { sheet }),
    ...(options.whole ? { whole: true as const } : {}),
  };
}
