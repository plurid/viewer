import { parse, printParseErrorCode } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { boundedText, diagnosticTextLimit, withoutTerminalSequences } from './text';
import {
  licenseKeyMarker,
  licenseLimits,
  licensePayloadSchema,
  licenseSignatureLength,
} from '../license/license';

const signature = /^[A-Za-z0-9_-]{85}[AQgw]$/;

function issuerPayload(encoded: string): boolean {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(base64);
    if (btoa(bytes).replace(/=+$/, '') !== base64) return false;
    const utf8 = Uint8Array.from(bytes, (ch) => ch.charCodeAt(0));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(utf8);
    return licensePayloadSchema.safeParse(JSON.parse(json)).success;
  } catch {
    return false;
  }
}

/** Supply enough text to test a partial token in its actual position in the JSON grammar. */
function jsonTokenSuffix(text: string, error: ParseError): string | undefined {
  if (error.offset + error.length !== text.length) return undefined;
  const token = text.slice(error.offset);
  switch (printParseErrorCode(error.error)) {
    case 'UnexpectedEndOfString':
      // Finish a pending backslash or Unicode escape before closing the string.
      return token.endsWith('\\') ? 'n"' : '0000"';
    case 'UnexpectedEndOfNumber':
      return '0';
    case 'InvalidSymbol':
      return ['-0', 'true', 'false', 'null']
        .find((literal) => literal.startsWith(token))
        ?.slice(token.length);
    default:
      return undefined;
  }
}

/** A partial issuer payload can be recognized before its final JSON bytes arrive. */
function possiblePayload(encoded: string): boolean {
  if (!encoded) return true;
  // The first sextet must allow a JSON space, an opening brace or a UTF-8 BOM.
  if (!'CDeI7'.includes(encoded[0]!)) return false;
  const available = encoded.length % 4 === 1 ? encoded.slice(0, -1) : encoded;
  const raw = atob(available.replace(/-/g, '+').replace(/_/g, '/'));
  let json: string;
  try {
    const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return false;
  }
  if (!/^[ \t\r\n]*(?:\{|$)/.test(json)) return false;
  const errors: ParseError[] = [];
  const value = parse(json, errors, { disallowComments: true });
  if (!errors.length) return licensePayloadSchema.safeParse(value).success;
  const incomplete = errors.find((error) => error.offset < json.length);
  if (!incomplete) return true;
  const suffix = jsonTokenSuffix(json, incomplete);
  if (!suffix) return false;
  const completed = json + suffix;
  const remaining: ParseError[] = [];
  parse(completed, remaining, { disallowComments: true });
  return remaining.every((error) => error.offset === completed.length);
}

type Candidate = 'complete' | 'partial';

function candidate(body: string): Candidate | undefined {
  if (body.length > licenseLimits.key) return;
  const dot = body.indexOf('.');
  if (dot < 0) return possiblePayload(body) ? 'partial' : undefined;
  if (!issuerPayload(body.slice(0, dot))) return;
  const tail = body.slice(dot + 1);
  if (signature.test(tail)) return 'complete';
  if (tail.length < licenseSignatureLength && /^[A-Za-z0-9_-]*$/.test(tail)) return 'partial';
}

/** A physical record supplies all of the evidence for each match. */
export function scanLicenseRecord(line: string, mask: (start: number, end: number) => void): void {
  const atom = /^[ \t"'“‘]*([A-Za-z0-9_.-]+)[ \t"'”’]*$/.exec(line)?.[1];
  if (atom && !atom.startsWith(licenseKeyMarker)) {
    const dot = atom.lastIndexOf('.');
    if (
      signature.test(atom.slice(dot + 1)) ||
      issuerPayload(dot === atom.length - 1 ? atom.slice(0, dot) : atom)
    ) {
      const at = line.indexOf(atom);
      mask(at, at + atom.length);
      return;
    }
  }
  const compact = line.replace(/[ \t]/g, '');
  if (!compact.includes(licenseKeyMarker)) return;
  const positions: number[] = [];
  for (let index = 0; index < line.length; index++)
    if (!/[ \t]/.test(line[index]!)) positions.push(index);
  const tokens = /viewer-license-1\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]{0,86})?)/g;
  for (const match of compact.matchAll(tokens)) {
    const end = positions[match.index + match[0].length - 1]! + 1;
    if (/[A-Za-z0-9_-]/.test(line[end] ?? '')) continue;
    const kind = candidate(match[1]!);
    if (kind === 'complete' || (kind === 'partial' && /^[ \t"'”’]*$/.test(line.slice(end))))
      mask(positions[match.index]!, end);
  }
}

/** Before IPC or display truncates a message, keep a key from becoming a visible fragment. */
export function boundedDiagnosticInput(input: string): string {
  const head = boundedText(input);
  if (input.length <= diagnosticTextLimit) return head;
  const visible = withoutTerminalSequences(head);
  const sample = withoutTerminalSequences(
    boundedText(input, diagnosticTextLimit + licenseLimits.key + 1),
  );
  let result = head;
  for (const line of sample.matchAll(/[^\r\n]+/g)) {
    scanLicenseRecord(line[0], (start, end) => {
      if (line.index + start < visible.length && line.index + end >= visible.length)
        result = boundedText(visible.slice(0, line.index + start) + '[redacted]');
    });
  }
  return result;
}
