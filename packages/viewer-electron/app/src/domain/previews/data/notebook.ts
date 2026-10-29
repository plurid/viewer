/**
 * Jupyter notebooks (nbformat 4) read for preview. Only the fields the preview shows are checked,
 * and a missing one reads as empty. Outputs are bounded; HTML is kept as text and never rendered.
 */

export type NotebookCellKind = 'markdown' | 'code' | 'raw';
export type NotebookImageType = 'image/png' | 'image/jpeg' | 'image/gif';
/** Where a text output came from: a stream, or a value's plain-text form. */
export type NotebookTextSource = 'stdout' | 'stderr' | 'result';

export interface NotebookTextOutput {
  kind: 'text';
  source: NotebookTextSource;
  text: string;
  truncated: boolean;
}
export interface NotebookMarkdownOutput {
  kind: 'markdown';
  text: string;
  truncated: boolean;
}
export interface NotebookImageOutput {
  kind: 'image';
  type: NotebookImageType;
  /** A `data:` URI of checked base64. */
  url: string;
  /** The output's plain-text form, such as `<Figure size 640x480 with 1 Axes>`. */
  alt: string;
}
export interface NotebookHTMLOutput {
  kind: 'html';
  /** The markup as text, for reading; it is never rendered. */
  source: string;
  truncated: boolean;
}
export interface NotebookErrorOutput {
  kind: 'error';
  name: string;
  message: string;
  traceback: string;
  truncated: boolean;
}
export interface NotebookOmittedOutput {
  kind: 'omitted';
  reason: string;
}
export type NotebookOutput =
  | NotebookTextOutput
  | NotebookMarkdownOutput
  | NotebookImageOutput
  | NotebookHTMLOutput
  | NotebookErrorOutput
  | NotebookOmittedOutput;

export interface NotebookCell {
  kind: NotebookCellKind;
  source: string;
  /** The source was longer than the preview limit. */
  truncated: boolean;
  execution?: number;
  outputs: NotebookOutput[];
  /** Outputs beyond the per-cell limit. */
  omittedOutputs: number;
  /** A Markdown cell's embedded images as `data:` URIs, by their `attachment:` URL. */
  attachments: Record<string, string>;
}

export interface Notebook {
  /** `4.5`, when the file states its format. */
  format?: string;
  /** The kernel's language, such as `python`. */
  language?: string;
  /** The language's file extension, without its dot. */
  extension?: string;
  /** The kernel's display name, such as `Python 3 (ipykernel)`. */
  kernel?: string;
  cells: NotebookCell[];
  /** Cells in the file, including any beyond the preview limit. */
  total: number;
}

export type NotebookReading = { ok: true; notebook: Notebook } | { ok: false; reason: string };

export interface NotebookLimits {
  cells: number;
  outputsPerCell: number;
  /** Characters of one cell source or text output. */
  text: number;
  /** Base64 characters of one image. */
  image: number;
}

export const notebookLimits: NotebookLimits = {
  cells: 1000,
  outputsPerCell: 100,
  text: 100_000,
  image: 2_000_000,
};

type JSONObject = Record<string, unknown>;

const imageTypes: readonly NotebookImageType[] = ['image/png', 'image/jpeg', 'image/gif'];
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
// colour and cursor sequences in tracebacks and progress output
const terminalSequences = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

const isObject = (value: unknown): value is JSONObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/** nbformat's multiline string: one string, or a list of lines that keep their line breaks. */
function multiline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter((line): line is string => typeof line === 'string').join('');
}

function bounded(value: string, limit: number): { text: string; truncated: boolean } {
  return value.length > limit
    ? { text: value.slice(0, limit), truncated: true }
    : { text: value, truncated: false };
}

/** A terminal's view of `\r`: a progress bar redraws its line, and its last state remains. */
function settleCarriageReturns(value: string): string {
  if (!value.includes('\r')) return value;
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const states = line.split('\r').filter((state) => state !== '');
      return states.at(-1) ?? '';
    })
    .join('\n');
}

function terminalText(value: string): string {
  return settleCarriageReturns(value.replace(terminalSequences, ''));
}

type ImageReading = { ok: true; url: string } | { ok: false; reason: string };

function imageURL(type: NotebookImageType, value: unknown, limits: NotebookLimits): ImageReading {
  const data = multiline(value).replace(/\s+/g, '');
  if (!data || !base64.test(data))
    return { ok: false, reason: 'An image output is not valid base64.' };
  if (data.length > limits.image)
    return { ok: false, reason: 'An image output exceeds the preview limit.' };
  return { ok: true, url: `data:${type};base64,${data}` };
}

/** The richest output form the preview shows safely: an image, Markdown, plain text, then HTML. */
function displayOutput(data: JSONObject, limits: NotebookLimits): NotebookOutput {
  const alt = multiline(data['text/plain']);
  for (const type of imageTypes) {
    if (!(type in data)) continue;
    const image = imageURL(type, data[type], limits);
    return image.ok
      ? { kind: 'image', type, url: image.url, alt: alt.slice(0, 500) }
      : { kind: 'omitted', reason: image.reason };
  }
  if ('text/markdown' in data)
    return { kind: 'markdown', ...bounded(multiline(data['text/markdown']), limits.text) };
  if ('text/plain' in data)
    return {
      kind: 'text',
      source: 'result',
      ...bounded(terminalText(alt), limits.text),
    };
  if ('text/html' in data) {
    const html = bounded(multiline(data['text/html']), limits.text);
    return { kind: 'html', source: html.text, truncated: html.truncated };
  }
  const types = Object.keys(data).slice(0, 4).join(', ');
  return {
    kind: 'omitted',
    reason: types ? `Output of type ${types} is not shown.` : 'An empty output is not shown.',
  };
}

function readOutput(output: unknown, limits: NotebookLimits): NotebookOutput | undefined {
  if (!isObject(output)) return undefined;
  switch (output.output_type) {
    case 'stream':
      return {
        kind: 'text',
        source: output.name === 'stderr' ? 'stderr' : 'stdout',
        // bounded once consecutive streams are merged
        text: multiline(output.text),
        truncated: false,
      };
    case 'display_data':
    case 'execute_result':
      return displayOutput(isObject(output.data) ? output.data : {}, limits);
    case 'error': {
      const traceback = Array.isArray(output.traceback)
        ? output.traceback.filter((line): line is string => typeof line === 'string').join('\n')
        : '';
      const bound = bounded(terminalText(traceback), limits.text);
      return {
        kind: 'error',
        name: nonEmpty(output.ename) ?? 'Error',
        message: terminalText(typeof output.evalue === 'string' ? output.evalue : ''),
        traceback: bound.text,
        truncated: bound.truncated,
      };
    }
    default:
      return typeof output.output_type === 'string'
        ? {
            kind: 'omitted',
            reason: `Output of type ${output.output_type.slice(0, 60)} is not shown.`,
          }
        : undefined;
  }
}

/** Jupyter shows consecutive writes to one stream as one block. */
function mergedStreams(outputs: NotebookOutput[], limits: NotebookLimits): NotebookOutput[] {
  const merged: NotebookOutput[] = [];
  for (const output of outputs) {
    const previous = merged.at(-1);
    if (
      output.kind === 'text' &&
      output.source !== 'result' &&
      previous?.kind === 'text' &&
      previous.source === output.source
    )
      previous.text += output.text;
    else merged.push(output.kind === 'text' ? { ...output } : output);
  }
  for (const output of merged) {
    if (output.kind !== 'text' || output.source === 'result') continue;
    const bound = bounded(terminalText(output.text), limits.text);
    output.text = bound.text;
    output.truncated = bound.truncated;
  }
  return merged;
}

function attachments(value: unknown, limits: NotebookLimits): Record<string, string> {
  const images: Record<string, string> = {};
  if (!isObject(value)) return images;
  for (const [name, bundle] of Object.entries(value)) {
    if (!isObject(bundle)) continue;
    const type = imageTypes.find((item) => item in bundle);
    const image = type ? imageURL(type, bundle[type], limits) : undefined;
    if (image?.ok) images[`attachment:${name}`] = image.url;
  }
  return images;
}

function readCell(cell: JSONObject, limits: NotebookLimits): NotebookCell {
  const kind: NotebookCellKind =
    cell.cell_type === 'code' || cell.cell_type === 'markdown' ? cell.cell_type : 'raw';
  const source = bounded(multiline(cell.source), limits.text);
  const outputs = kind === 'code' && Array.isArray(cell.outputs) ? cell.outputs : [];
  const read = outputs
    .slice(0, limits.outputsPerCell)
    .map((output) => readOutput(output, limits))
    .filter((output): output is NotebookOutput => !!output);
  const count = cell.execution_count;
  return {
    kind,
    source: source.text,
    truncated: source.truncated,
    execution: typeof count === 'number' && Number.isInteger(count) ? count : undefined,
    outputs: mergedStreams(read, limits),
    omittedOutputs: Math.max(0, outputs.length - limits.outputsPerCell),
    attachments: kind === 'code' ? {} : attachments(cell.attachments, limits),
  };
}

export function parseNotebook(source: string, limits = notebookLimits): NotebookReading {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `The file is not valid JSON. ${detail}` };
  }
  if (!isObject(value)) return { ok: false, reason: 'The file is not a notebook object.' };
  const major = value.nbformat;
  if (typeof major === 'number' && major < 4)
    return { ok: false, reason: `Notebook format ${major} is not supported; format 4 is.` };
  if (!Array.isArray(value.cells)) return { ok: false, reason: 'The notebook has no cell list.' };
  const minor = value.nbformat_minor;
  const metadata = isObject(value.metadata) ? value.metadata : {};
  const language = isObject(metadata.language_info) ? metadata.language_info : {};
  const kernel = isObject(metadata.kernelspec) ? metadata.kernelspec : {};
  const cells = value.cells
    .slice(0, limits.cells)
    .filter(isObject)
    .map((cell) => readCell(cell, limits));
  return {
    ok: true,
    notebook: {
      format:
        typeof major === 'number'
          ? typeof minor === 'number'
            ? `${major}.${minor}`
            : String(major)
          : undefined,
      language: nonEmpty(language.name) ?? nonEmpty(kernel.language),
      extension: nonEmpty(language.file_extension)?.replace(/^\./, ''),
      kernel: nonEmpty(kernel.display_name),
      cells,
      total: value.cells.length,
    },
  };
}
