import { WorkerJsonValue } from './worker-json';
import {
  closingQuotes,
  CredentialField,
  isCredentialLabel,
  isCredentialOption,
  privateKeyHeader,
  pemLineLimit,
  unclosedLabelQuote,
} from '../../domain/diagnostics/secrets';

type LineDisposition = 'empty' | 'record' | 'omit';
type ValuePosition = 'outside' | 'field-name' | 'before' | 'inside';
type QueryPosition = 'outside' | 'fragment' | 'query';
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
  private pemFooter = '';
  private pemRemaining = 0;
  private marker: string | undefined = '';
  private value: ValuePosition = 'outside';
  private quote = '';
  private nextOption?: string;
  private escaped = false;
  private continuedValue = false;
  private terminal?: TerminalSequence;

  private member?: 'colon' | 'value';
  private memberField = false;
  private memberBoundary = true;
  private memberName?: string;
  private json?: WorkerJsonValue;
  private hasText = false;

  private colorParameters = '';
  private query: QueryPosition = 'outside';

  scan(text: string): void {
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
    if (this.marker !== undefined) {
      if (this.marker || !/[ \t]/.test(ch)) {
        if ((!this.marker && ch !== '-') || this.marker.length > 64) this.marker = undefined;
        else if (!(this.marker.endsWith('KEY-----') && /[ \t]/.test(ch))) this.marker += ch;
      }
    }
    if (this.pemRemaining) return;
    if (this.value === 'before' || this.value === 'inside') {
      this.scanOptionValue(ch);
      return;
    }
    if (!this.field && !this.json && this.inQuery(ch)) return;
    if (this.inJsonValue(ch)) return;
    const memberStart = !this.field || (this.memberBoundary && !this.field.continues);
    this.memberBoundary = !this.field || /[ \t,{]/.test(ch);
    this.field?.scan(ch);
    if (ch === '"' && !this.quote) {
      if (this.memberName && isCredentialLabel(this.memberName)) this.member = 'colon';
      this.memberName = memberStart ? '' : undefined;
    } else if (this.memberName !== undefined) {
      this.memberName = /[A-Za-z0-9_-]/.test(ch) ? appendLabel(this.memberName, ch) : undefined;
    }
    if (!this.field) this.scanArgument(ch);
  }

  /** Brackets are structural only inside the value of a recognized JSON member. */
  private inJsonValue(ch: string): boolean {
    if (this.json) {
      if (this.json.scan(ch)) return true;
      this.json = undefined;
      if (ch === '"' || ch === '}' || ch === ']') return true;
    }
    if (this.member && !/\s/.test(ch)) {
      if (this.member === 'colon' && ch === ':') this.member = 'value';
      else {
        const structured = this.member === 'value' && (ch === '{' || ch === '[' || ch === '"');
        this.member = undefined;
        if (structured) {
          if (this.memberField) this.field = undefined;
          this.memberField = false;
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
    this.flushColorParameters();
    this.query = 'outside';
    const inBlock = this.pemRemaining > 0;
    if (inBlock) {
      this.pemRemaining--;
      if (this.marker === this.pemFooter) this.pemRemaining = 0;
    } else if (!this.continuedValue && this.marker) {
      const header = privateKeyHeader.exec(this.marker);
      if (header) {
        this.pemRemaining = pemLineLimit - 1;
        this.pemFooter = '-----END ' + header[1] + '-----';
      }
    }
    this.marker = '';
    if (!this.json?.finishLine()) this.json = undefined;
    const openValue = Boolean(this.quote);
    const openRecord = openValue || !!this.field?.continues || !!this.json;
    if (this.field?.continues) this.field.scan('\n');
    else this.field = undefined;
    this.memberField = false;
    this.memberName = undefined;
    this.member = undefined;
    this.terminal = undefined;
    const omit = this.continuedValue || openRecord || inBlock || this.pemRemaining > 0;
    this.continuedValue = openRecord;
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
      const next = isCredentialOption(name);
      this.value = next ? 'before' : 'outside';
      this.nextOption = next ? '' : undefined;
      return;
    }
    if (this.nextOption !== undefined) {
      const valid = this.nextOption ? /[A-Za-z0-9_-]/.test(ch) : ch === '-';
      this.nextOption = valid ? appendLabel(this.nextOption, ch) : undefined;
    }
  }

  private inQuery(ch: string): boolean {
    if (/\s/.test(ch)) this.query = 'outside';
    else if (ch === '#') this.query = 'fragment';
    else if (ch === '?' && this.query !== 'fragment') this.query = 'query';
    if (this.query !== 'query') return false;
    this.label = '';
    return true;
  }

  private scanArgument(ch: string): void {
    const space = /\s/.test(ch);
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
        if (!option) {
          this.field = new CredentialField(this.label);
          this.memberField = this.member === 'value';
        }
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
