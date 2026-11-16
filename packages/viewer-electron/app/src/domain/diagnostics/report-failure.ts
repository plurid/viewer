import { boundedText } from './text';

const errorNames = new Set([
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
  'AggregateError', 'InternalError', 'SystemError', 'AssertionError', 'AbortError', 'DOMException',
  'TimeoutError', 'LineError', 'QueryError', 'FontError', 'CLIUsageError', 'EPSIPreviewLimitError',
  'OperationCancelled', 'NotEditable', 'WebPreviewError', 'Stopped', 'CheckHTTPError',
  'ReceiptFailure', 'NoTrash', 'UpdateError', 'LicenseError', 'CLIOperationError',
  'CLIConnectionError', 'CLIServiceError', 'ProviderResponseError', 'SamMaskError',
  'ModelPermissionRequired', 'FileAccessRequired',
]);
const codeShape = /^[A-Z][A-Z0-9_]{1,47}$/;
const functionShape = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export interface ReportFrame {
  path: string;
  line: number;
  column: number;
  function?: string;
}
export interface ReportFailure {
  name: string;
  code?: string;
  frames: ReportFrame[];
  outside: number;
}

/** Lexical containment also rejects encoded traversals; no file contents or identities are read. */
export function reportPath(value: string): string | undefined {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  try {
    let file = value;
    if (file.startsWith('file:')) {
      const address = new URL(file);
      if (address.protocol !== 'file:' || (address.hostname && address.hostname !== 'localhost'))
        return undefined;
      file = address.pathname;
    }
    file = decodeURIComponent(file).normalize('NFC');
    if (!file.startsWith('/') || /[\p{Cc}\p{Cf}\\]/u.test(file)) return undefined;
    const parts: string[] = [];
    for (const part of file.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  } catch {
    return undefined;
  }
}

export function bundleRelativePath(file: string, bundle: string | undefined): string | undefined {
  const root = bundle ? reportPath(bundle) : undefined;
  const actual = reportPath(file);
  if (!root || !actual?.startsWith(root + '/')) return undefined;
  const relative = actual.slice(root.length + 1);
  return relative.length <= 512 && /^[A-Za-z0-9_./@()+ -]+$/.test(relative) ? relative : undefined;
}

/** Only allowlisted names, a bounded code and contained code locations cross this boundary. */
export function reportFailure(entry: Record<string, unknown>, bundle: string | undefined): ReportFailure {
  const detail = boundedText(typeof entry.detail === 'string' ? entry.detail : '');
  const header = /^([A-Za-z][A-Za-z0-9]{0,47}):[ \t]*/.exec(detail);
  const knownHeader = header && errorNames.has(header[1]!);
  const named = typeof entry.errorClass === 'string' ? entry.errorClass : header?.[1];
  const name = named && errorNames.has(named) ? named : 'Error';
  const message = knownHeader ? detail.slice(header[0].length) : detail;
  const startCode = /^([A-Z][A-Z0-9_]{1,47})(?=:|\s|$)/.exec(message)?.[1];
  const candidate = typeof entry.code === 'string' ? entry.code : startCode;
  const code = candidate && codeShape.test(candidate) ? candidate : undefined;
  const result: ReportFailure = { name, code, frames: [], outside: 0 };
  const stack = boundedText(typeof entry.stack === 'string' ? entry.stack : detail);
  for (const raw of stack.split('\n')) {
    const frame = raw.trimStart();
    if (!frame.startsWith('at ')) continue;
    let location = frame.slice(3);
    let functionName: string | undefined;
    const opening = location.lastIndexOf(' (');
    if (opening >= 0 && location.endsWith(')')) {
      const named = location.slice(0, opening).replace(/^(?:async |new )/, '');
      if (named.length <= 120 && functionShape.test(named)) functionName = named;
      location = location.slice(opening + 2, -1);
    }
    const last = location.lastIndexOf(':');
    const previous = location.lastIndexOf(':', last - 1);
    const lineText = location.slice(previous + 1, last);
    const columnText = location.slice(last + 1);
    const relative = previous > 0 ? bundleRelativePath(location.slice(0, previous), bundle) : undefined;
    if (!relative || !/^[1-9]\d{0,8}$/.test(lineText) || !/^[1-9]\d{0,8}$/.test(columnText)) {
      result.outside++;
      continue;
    }
    if (result.frames.length < 32) result.frames.push({
      path: relative, line: Number(lineText), column: Number(columnText), function: functionName,
    });
  }
  return result;
}
