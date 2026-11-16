import { boundedText } from './text';
import { knownErrorCode, knownErrorName } from './failure';

export interface ReportFrame {
  path: string;
  line: number;
  column: number;
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
  if (file.startsWith('viewer-app:')) {
    // URL parsing normalizes dot segments, so reject them before constructing a URL.
    const match = /^viewer-app:\/\/app\/([^?#]*)$/.exec(file);
    if (!match || /%|\\|[\p{Cc}\p{Cf}]/u.test(match[1]!)) return undefined;
    const parts = match[1]!.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return undefined;
    return match[1]!.length <= 512 && /^[A-Za-z0-9_./@()+ -]+$/.test(match[1]!)
      ? match[1] : undefined;
  }
  const root = bundle ? reportPath(bundle) : undefined;
  const actual = reportPath(file);
  if (!root || !actual?.startsWith(root + '/')) return undefined;
  const relative = actual.slice(root.length + 1);
  return relative.length <= 512 && /^[A-Za-z0-9_./@()+ -]+$/.test(relative) ? relative : undefined;
}

/** Only allowlisted names, a bounded code and contained code locations cross this boundary. */
export function reportFailure(
  entry: Record<string, unknown>,
  bundle: string | undefined,
  errno: ReadonlySet<string> = new Set(),
): ReportFailure {
  const name = knownErrorName(entry.errorClass) ?? 'Error';
  const code = knownErrorCode(entry.code, errno);
  const result: ReportFailure = { name, code, frames: [], outside: 0 };
  const stack = boundedText(typeof entry.stack === 'string' ? entry.stack : '');
  for (const raw of stack.split('\n')) {
    const frame = raw.trimStart();
    if (!frame.startsWith('at ')) continue;
    let location = frame.slice(3);
    const opening = location.lastIndexOf(' (');
    if (opening >= 0 && location.endsWith(')')) {
      location = location.slice(opening + 2, -1);
    }
    const last = location.lastIndexOf(':');
    const previous = location.lastIndexOf(':', last - 1);
    const lineText = location.slice(previous + 1, last);
    const columnText = location.slice(last + 1);
    const relative =
      previous > 0 ? bundleRelativePath(location.slice(0, previous), bundle) : undefined;
    if (!relative || !/^[1-9]\d{0,8}$/.test(lineText) || !/^[1-9]\d{0,8}$/.test(columnText)) {
      result.outside++;
      continue;
    }
    if (result.frames.length < 32)
      result.frames.push({
        path: relative,
        line: Number(lineText),
        column: Number(columnText),
      });
  }
  return result;
}
