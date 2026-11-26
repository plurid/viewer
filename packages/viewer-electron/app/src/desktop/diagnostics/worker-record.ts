import { WorkerJsonValue } from './worker-json';
import {
  closingQuotes,
  CredentialField,
  isCredentialLabel,
  unclosedLabelQuote,
} from '../../domain/diagnostics/secrets';

type LineDisposition = 'empty' | 'record' | 'omit';
type ValuePosition = 'outside' | 'field-name' | 'before' | 'inside';
type QueryPosition = 'outside' | 'fragment' | 'name' | 'query' | 'value' | 'private-value';
type TerminalSequence = 'escape' | 'intermediate' | 'csi' | 'string' | 'string-escape';

/** Retain the beginning of a quoted option and the normalized suffix used by the classifier. */
function appendLabel(label: string, ch: string): string {
  if (label.length >= 160)
    label = label.slice(0, 4) + label.slice(4).replace(/[-_]/g, '').slice(-64);
  return label + ch;
}

/** Worker writes can end anywhere in a credential, even after the log's text limit.
 * Retain delimiters and a bounded potential label independently of the displayed text. */
export class WorkerRecordBoundary {
  private label = '';
  private field?: CredentialField;
  private keyBlock = false;
  private markerTail = '';
  private value: ValuePosition = 'outside';
  private quote = '';
  private nextOption?: string;
  private escaped = false;
  private continuedValue = false;
  private terminal?: TerminalSequence;

  private member?: 'colon' | 'value';
  private awaitingMemberLine = false;
  private scalarLine?: string;
  private memberName?: string;
  private json?: WorkerJsonValue;
  private hasText = false;

  private colorParameters = '';
  private trailingCR = false;
  private query: QueryPosition = 'outside';

  constructor(private scanLicense: (ch: string) => void) {}

  scan(text: string): void {
    if (this.trailingCR) text = '\r' + text;
    this.trailingCR = text.endsWith('\r');
    if (this.trailingCR) text = text.slice(0, -1);
    for (const raw of text) {
      if (this.skipControl(raw)) continue;
      const ch = /\p{Cc}/u.test(raw) ? ' ' : raw;
      // Some diagnostics contain SGR parameters with the escape byte already stripped.
      if (this.colorParameters) {
        if (/[0-9;:]/.test(ch)) {
          // Digits and parameter separators cannot introduce quotes or nested delimiters.
          this.colorParameters = this.colorParameters.slice(0, 6) + ch;
          continue;
        }
        if (ch === 'm' && this.colorParameters.length > 1) {
          this.colorParameters = '';
          continue;
        }
        this.flushColorParameters();
      }
      if (ch === '[') this.colorParameters = ch;
      else this.visible(ch);
    }
  }

  private flushColorParameters(): void {
    for (const ch of this.colorParameters) this.visible(ch);
    this.colorParameters = '';
  }

  private visible(ch: string): void {
    if (!/\s/.test(ch)) this.hasText = true;
    if (this.scalarLine !== undefined && this.scalarLine.length <= 2000) this.scalarLine += ch;
    const queryValue = this.query === 'value' || this.query === 'private-value';
    const claimed = this.field || this.json || this.value === 'before' || this.value === 'inside' || this.query === 'private-value';
    if (this.keyBlock) {
      this.scanKeyBlock(ch);
      return;
    }
    if (claimed) {
      this.scanLicense('\0');
      this.markerTail = '';
    } else {
      this.scanLicense(ch);
      this.scanKeyBlock(ch);
      if (this.keyBlock) return;
    }
    if (queryValue && !/[\s&#]/.test(ch)) return;
    if (this.value === 'before' || this.value === 'inside') {
      this.scanOptionValue(ch);
      return;
    }
    const literal = this.field?.scan(ch);
    if (this.inJsonValue(ch)) return;
    if (ch === '"' && !this.quote) {
      if (this.memberName && isCredentialLabel(this.memberName)) this.member = 'colon';
      this.memberName = literal ? undefined : '';
    } else if (this.memberName !== undefined) {
      this.memberName = /[A-Za-z0-9_-]/.test(ch) ? appendLabel(this.memberName, ch) : undefined;
    }
    if (!this.field) this.scanArgument(ch);
  }

  private scanKeyBlock(ch: string): void {
    // PEM boundaries can occur past the retained portion of a line or across chunks.
    this.markerTail = this.markerTail.slice(-64) + ch;
    if (ch === '-' && this.markerTail.endsWith('-----')) {
      if (/-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----$/.test(this.markerTail)) this.keyBlock = true;
      if (/-----END [A-Z ]{0,32}PRIVATE KEY-----$/.test(this.markerTail)) this.keyBlock = false;
    }
  }

  /** Brackets are structural only inside the value of a recognized JSON member. */
  private inJsonValue(ch: string): boolean {
    if (this.json) {
      if (this.json.scan(ch)) return true;
      this.json = undefined;
    }
    if (this.member && !/\s/.test(ch)) {
      if (this.member === 'colon' && ch === ':') this.member = 'value';
      else {
        const structured = this.member === 'value' && (ch === '{' || ch === '[' || ch === '"');
        if (this.member === 'value' && this.awaitingMemberLine) {
          if (structured) this.continuedValue = true;
          else if (/[tfn\d-]/.test(ch)) this.scalarLine = ch;
        }
        this.member = undefined;
        if (structured) {
          this.json = new WorkerJsonValue(ch);
          this.value = 'outside';
          this.label = '';
          return true;
        }
      }
    }
    return false;
  }

  /** Advance even for omitted and rate-limited physical lines. */
  finishLine(): LineDisposition {
    this.trailingCR = false;
    this.flushColorParameters();
    this.query = 'outside';
    this.scanLicense('\n');
    if (this.json && !this.json.scan('\n')) this.json = undefined;
    const openValue = Boolean(this.quote || this.escaped);
    const openRecord =
      openValue ||
      Boolean(
        this.field?.continues ||
        this.terminal ||
        this.json ||
        this.keyBlock,
      );
    if (this.field?.continues) this.field.scan('\n');
    else this.field = undefined;
    this.markerTail = '';
    this.memberName = undefined;
    const scalar = this.scalarLine !== undefined &&
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)[ \t]*(?:[,}\]]|$)/.test(this.scalarLine);
    const omit = this.continuedValue || openRecord || scalar;
    this.continuedValue = openRecord;
    this.awaitingMemberLine = this.member === 'value';
    this.scalarLine = undefined;
    this.nextOption = undefined;
    if (!openValue) this.value = 'outside';
    this.escaped = false;
    this.label = '';
    const empty = !this.hasText;
    this.hasText = false;
    return empty ? 'empty' : omit ? 'omit' : 'record';
  }

  private credentialLabel(): boolean {
    if (!this.label) return false;
    const label = this.label.replace(/^['"\x60“‘]|['"\x60”’]$/g, '');
    return label.toLowerCase() === '-u' || isCredentialLabel(label);
  }

  private scanOptionValue(ch: string): void {
    if (this.escaped) {
      this.escaped = false;
      return;
    }
    if (this.value === 'before' && /\s/.test(ch)) return;
    this.value = 'inside';
    if (ch === '\\' && this.quote !== "'") {
      this.escaped = true;
      this.nextOption = undefined;
      return;
    }
    if (this.quote) {
      if (ch === this.quote) {
        this.quote = '';
        return;
      }
    } else if (closingQuotes[ch]) {
      this.quote = closingQuotes[ch]!;
      return;
    } else if (/\s/.test(ch)) {
      // A missing operand can put another credential option in its place.
      const name = this.nextOption ?? '';
      const next = name === '-u' || (name.startsWith('--') && isCredentialLabel(name.slice(2)));
      this.value = next ? 'before' : 'outside';
      this.nextOption = next ? '' : undefined;
      return;
    }
    if (this.nextOption !== undefined) {
      const valid = this.nextOption ? /[A-Za-z0-9_-]/.test(ch) : ch === '-';
      this.nextOption = valid ? appendLabel(this.nextOption, ch) : undefined;
    }
  }

  private scanArgument(ch: string): void {
    const space = /\s/.test(ch);
    const queryEquals = this.query === 'name' && ch === '=';
    if (space) this.query = 'outside';
    else if (ch === '#') this.query = 'fragment';
    else if (this.query !== 'fragment') {
      if (ch === '?' || (ch === '&' && this.query !== 'outside')) this.query = 'name';
      else if (queryEquals) this.query = this.credentialLabel() ? 'private-value' : 'value';
      else if (this.query === 'name' && !/[A-Za-z0-9_-]/.test(ch)) this.query = 'query';
    }
    if (this.value === 'field-name') {
      if (space) return;
      this.value = 'outside';
      if (ch === '=' || ch === ':') {
        this.field ??= new CredentialField(this.label);
        this.label = '';
        return;
      }
      this.label = '';
    }
    if (space || ch === '=' || ch === ':') {
      if (this.credentialLabel()) {
        const option = /^['"\x60“‘]?-(?:-|u['"\x60”’]?$)/i.test(this.label);
        this.value = option ? (space ? 'before' : 'inside') : space ? 'field-name' : 'outside';
        this.nextOption = option && space ? '' : undefined;
        if (!option && space) return;
        if (!option && !queryEquals) this.field ??= new CredentialField(this.label);
        if (option && ch === '=') this.quote = unclosedLabelQuote(this.label);
      }
      this.label = '';
    } else {
      if (/[A-Za-z0-9_'"\x60“”‘’-]/.test(ch)) {
        this.label = appendLabel(this.label, ch);
      } else this.label = '';
    }
  }

  private skipControl(ch: string): boolean {
    if (this.terminal === 'string' || this.terminal === 'string-escape') {
      if (ch === '\x07' || ch === '\x9c' || (this.terminal === 'string-escape' && ch === '\\'))
        this.terminal = undefined;
      else this.terminal = ch === '\x1b' ? 'string-escape' : 'string';
    } else if (ch === '\x1b') this.terminal = 'escape';
    else if (this.terminal === 'escape') {
      if (ch === '[') this.terminal = 'csi';
      else if (']PX^_'.includes(ch)) this.terminal = 'string';
      else this.terminal = /[ -\/]/.test(ch) ? 'intermediate' : undefined;
    } else if (this.terminal === 'intermediate') {
      if (!/[ -\/]/.test(ch)) this.terminal = undefined;
    } else if (ch === '\x9b') this.terminal = 'csi';
    else if (/[\x90\x98\x9d-\x9f]/.test(ch)) this.terminal = 'string';
    else if (this.terminal === 'csi') {
      if (/[@-~\x18\x1a]/.test(ch)) this.terminal = undefined;
    } else return ch === '\x9c' || /\p{Cf}/u.test(ch);
    return true;
  }
}
