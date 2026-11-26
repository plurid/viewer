import { isCredentialLabel } from '../../domain/diagnostics/secrets';

type LineDisposition = 'empty' | 'record' | 'omit';
type ValuePosition = 'outside' | 'field-name' | 'before' | 'inside';
type TerminalSequence = 'escape' | 'intermediate' | 'csi' | 'string' | 'string-escape';

const closingQuotes: Readonly<Record<string, string | undefined>> = {
  "'": "'",
  '"': '"',
  '\x60': '\x60',
  '“': '”',
  '‘': '’',
};

/** Worker writes can end anywhere in a credential, even after the log's text limit.
 * Retain delimiters and a bounded potential label independently of the displayed text. */
export class WorkerRecordBoundary {
  private label = '';
  private value: ValuePosition = 'outside';
  private quote = '';
  private quotedOption?: string;
  private escaped = false;
  private continuedValue = false;
  private terminal?: TerminalSequence;

  private depth = 0;
  private pendingMember = false;
  private opens = 0;
  private closes = 0;
  private jsonString = false;
  private jsonEscape = false;
  private prefix = '';
  private last = '';

  private colorParameters = '';

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
    if (this.prefix.length < 6 && (this.prefix || !/\s/.test(ch))) this.prefix += ch;
    if (!/\s/.test(ch)) this.last = ch;
    if (this.inQuotedValue(ch)) {
      this.jsonString = false;
      this.jsonEscape = false;
      return;
    }
    if (this.jsonEscape) this.jsonEscape = false;
    else if (this.jsonString && ch === '\\') this.jsonEscape = true;
    else if (ch === '"') this.jsonString = !this.jsonString;
    else if (!this.jsonString) {
      if (ch === '[' || ch === '{') this.opens++;
      if (ch === ']' || ch === '}') {
        if (this.opens) this.opens--;
        else this.closes++;
      }
    }
  }

  /** Advance even for omitted and rate-limited physical lines. */
  finishLine(): LineDisposition {
    this.flushColorParameters();
    const empty = !this.prefix;
    const openValue = Boolean(this.quote || this.escaped);
    const openRecord = openValue || Boolean(this.terminal);
    let omit = this.continuedValue || openRecord;
    if (this.prefix) {
      const possibleJson =
        /^(?:["\]{}:,\d-]|(?:true|false|null)\b|\[(?![A-Za-z])|\[(?:true|false|null)\b)/.test(
          this.prefix,
        );
      const continuation = possibleJson && (this.depth > 0 || this.pendingMember);
      omit ||= continuation;
      this.depth = Math.max(0, (continuation ? this.depth : 0) - this.closes) + this.opens;
      const credential =
        this.value === 'before' || this.value === 'field-name' || this.credentialLabel();
      this.pendingMember =
        (this.last === '"' && credential) ||
        (this.last === ':' && (credential || (continuation && this.pendingMember)));
    }
    this.continuedValue = openRecord;
    this.quotedOption = undefined;
    if (!openValue) this.value = 'outside';
    this.escaped = false;
    this.label = '';
    this.opens = this.closes = 0;
    this.prefix = this.last = '';
    this.jsonString = this.jsonEscape = false;
    return empty ? 'empty' : omit ? 'omit' : 'record';
  }

  private credentialLabel(): boolean {
    if (!this.label) return false;
    const label = this.label.replace(/^['"\x60“‘]|['"\x60”’]$/g, '');
    return label.toLowerCase() === '-u' || isCredentialLabel(label);
  }

  private inQuotedValue(ch: string): boolean {
    const space = /\s/.test(ch);
    if (this.value === 'field-name') {
      if (space) return false;
      this.value = ch === '=' || ch === ':' ? 'before' : 'outside';
      if (this.value === 'before') return false;
    }
    if (this.escaped) {
      this.escaped = false;
      return true;
    }
    if (this.value !== 'outside' && ch === '\\' && this.quote !== "'") {
      this.value = 'inside';
      this.escaped = true;
      this.quotedOption = undefined;
      return true;
    }
    if (this.quote) {
      if (ch === this.quote) {
        this.quote = '';
        this.label = this.quotedOption ?? '';
        this.quotedOption = undefined;
      } else if (this.quotedOption !== undefined) {
        // An empty option can be followed by another quoted option with its own value.
        const valid = this.quotedOption ? /[A-Za-z0-9_-]/.test(ch) : ch === '-';
        this.quotedOption =
          valid && this.quotedOption.length < 82 ? this.quotedOption + ch : undefined;
      }
      return true;
    }
    if (this.value !== 'outside' && closingQuotes[ch]) {
      this.quote = closingQuotes[ch]!;
      this.quotedOption = '';
      this.value = 'inside';
      this.label = '';
      return true;
    }
    if (space || ch === '=' || ch === ':') {
      if (this.credentialLabel()) {
        const option = /^['"\x60“‘]?-(?:-|u['"\x60”’]?$)/i.test(this.label);
        this.value = space && !option ? 'field-name' : 'before';
        // In '--option=value' the opening quote belongs to the entire argument.
        const closing = closingQuotes[this.label[0]!];
        if (ch === '=' && closing && !this.label.endsWith(closing)) this.quote = closing;
      } else if (space && this.value === 'inside') this.value = 'outside';
      this.label = '';
    } else {
      if (this.value === 'before') this.value = 'inside';
      if (/[A-Za-z0-9_'"\x60“”‘’-]/.test(ch)) {
        // The credential matcher accepts labels of at most 80 characters.
        if (this.label.length >= 160) this.label = this.label.slice(-80);
        this.label += ch;
      } else this.label = '';
    }
    return false;
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
