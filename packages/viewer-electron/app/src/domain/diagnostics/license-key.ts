import { parse, printParseErrorCode } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { boundedText, diagnosticTextLimit, withoutTerminalSequences } from './text';
import {
  licenseKeyMarker,
  licenseLimits,
  licensePayloadSchema,
  licenseSignatureLength,
} from '../license/license';

const alphabet = /^[A-Za-z0-9_-]$/;

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

/** Only defer a physical line while the decoded bytes can still be a license JSON object. */
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

interface KeyCandidate {
  start: number;
  markerEnd: number;
  size: number;
  payload: string;
  checkedLength: number;
  signature?: string;
  last: number;
}

/** Positions are character offsets for text and physical line numbers for worker stderr. */
export class DiagnosticLicenseKey {
  private prefix = 0;
  private prefixStart = 0;
  private prefixSize = 0;
  private candidate?: KeyCandidate;

  constructor(private matched: (start: number, markerEnd: number, last: number) => void) {}

  pendingLine(): number | undefined {
    const candidate = this.candidate;
    if (
      candidate &&
      candidate.signature === undefined &&
      candidate.checkedLength !== candidate.payload.length
    ) {
      candidate.checkedLength = candidate.payload.length;
      if (!possiblePayload(candidate.payload)) this.candidate = undefined;
    }
    return this.candidate?.markerEnd;
  }

  scan(ch: string, position: number): void {
    const wrapping = /\s/.test(ch);
    if (this.candidate) this.scanBody(this.candidate, ch, position, wrapping);

    if (this.prefix && ++this.prefixSize > licenseLimits.key) this.prefix = 0;
    if (wrapping) return;
    if (this.prefix && ch === licenseKeyMarker[this.prefix]) {
      if (++this.prefix === licenseKeyMarker.length) {
        this.candidate = {
          start: this.prefixStart,
          markerEnd: position,
          size: this.prefixSize,
          payload: '',
          checkedLength: 0,
          last: position,
        };
        this.prefix = 0;
      }
    } else {
      this.prefix = ch === licenseKeyMarker[0] ? 1 : 0;
      this.prefixStart = position;
      this.prefixSize = 1;
    }
  }

  private scanBody(candidate: KeyCandidate, ch: string, position: number, wrapping: boolean): void {
    if (candidate.signature?.length === licenseSignatureLength) {
      if (alphabet.test(ch)) this.candidate = undefined;
      else this.finish();
      return;
    }
    if (++candidate.size > licenseLimits.key) {
      this.candidate = undefined;
      return;
    }
    if (wrapping) return;
    if (alphabet.test(ch)) {
      if (candidate.signature !== undefined) {
        candidate.signature += ch;
        candidate.last = position;
      } else candidate.payload += ch;
    } else if (ch === '.' && candidate.signature === undefined && issuerPayload(candidate.payload))
      candidate.signature = '';
    else this.candidate = undefined;
  }

  finish(): void {
    const candidate = this.candidate;
    // A canonical 64-byte Ed25519 signature has four possible final base64url characters.
    if (
      candidate?.signature?.length === licenseSignatureLength &&
      /[AQgw]$/.test(candidate.signature)
    )
      this.matched(candidate.start, candidate.markerEnd, candidate.last);
    this.candidate = undefined;
  }
}

/** Before IPC or display truncates a message, keep a complete key from becoming a visible fragment. */
export function boundedDiagnosticInput(input: string): string {
  const head = boundedText(input);
  if (input.length <= diagnosticTextLimit) return head;
  const visibleHead = withoutTerminalSequences(head);
  const cut = visibleHead.length;
  const sample = withoutTerminalSequences(
    boundedText(input, diagnosticTextLimit + licenseLimits.key + 1),
  );
  let result = head;
  const scanner = new DiagnosticLicenseKey((start, _markerEnd, last) => {
    if (start < cut && last >= cut)
      result = boundedText(visibleHead.slice(0, start) + '[redacted]');
  });
  for (let index = Math.max(0, cut - licenseLimits.key); index < sample.length; index++) {
    const ch = sample[index]!;
    if (!/\p{Cf}/u.test(ch)) scanner.scan(/\p{Cc}/u.test(ch) ? ' ' : ch, index);
  }
  scanner.finish();
  return result;
}
