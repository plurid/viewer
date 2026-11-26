type Expectation = 'first-key' | 'key' | 'colon' | 'first-value' | 'value' | 'separator';

/** Validate an unfinished credential array or object without retaining its strings or numbers. */
export class WorkerJsonValue {
  private closing: string[] = [];
  private expect: Expectation = 'value';
  private string = false;
  private escape = false;
  private unicode = 0;
  private malformedString = false;
  private atom = '';
  private overflow = 0;

  constructor(open: string) {
    if (open === '"') this.string = true;
    else this.open(open);
  }

  private open(ch: string): void {
    // At extreme nesting, omit the whole subtree until its delimiters balance.
    if (this.closing.length >= 256) this.overflow++;
    else this.closing.push(ch === '{' ? '}' : ']');
    this.expect = ch === '{' ? 'first-key' : 'first-value';
  }

  /** True while another character can belong to this structured value. */
  scan(ch: string): boolean {
    if (this.string) {
      if (this.unicode) {
        if (/[a-f0-9]/i.test(ch)) {
          this.unicode--;
          return true;
        }
        this.unicode = 0;
        this.malformedString = true;
      }
      if (this.escape) {
        this.escape = false;
        if (ch === 'u') this.unicode = 4;
        else if (!/["\\/bfnrt]/.test(ch)) this.malformedString = true;
      } else if (ch === '\\') this.escape = true;
      else if (ch === '"') {
        this.string = false;
        // An invalid escape still belongs to the credential until the quote closes.
        if (this.malformedString || !this.closing.length) return false;
      }
      return true;
    }
    if (this.overflow) {
      if (ch === '"') this.string = true;
      if (ch === '[' || ch === '{') this.overflow++;
      if (ch === ']' || ch === '}') {
        this.overflow--;
        this.expect = 'separator';
      }
      return true;
    }
    if (this.atom) {
      if (/[a-z0-9.+-]/i.test(ch)) {
        // Two digits retain all grammar, including an invalid leading zero.
        if (!/\d/.test(ch) || !/\d\d$/.test(this.atom)) this.atom += ch;
        return this.atom.length <= 16;
      }
      if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(this.atom))
        return false;
      this.atom = '';
      this.expect = 'separator';
    }
    if (/\s/.test(ch)) return true;
    if (ch === this.closing.at(-1)) {
      if (!['first-key', 'first-value', 'separator'].includes(this.expect)) return false;
      this.closing.pop();
      this.expect = 'separator';
      return this.closing.length > 0;
    }
    if (this.expect === 'first-key' || this.expect === 'key') {
      if (ch !== '"') return false;
      this.string = true;
      this.expect = 'colon';
    } else if (this.expect === 'colon') {
      if (ch !== ':') return false;
      this.expect = 'value';
    } else if (this.expect === 'separator') {
      if (ch !== ',') return false;
      this.expect = this.closing.at(-1) === '}' ? 'key' : 'value';
    } else if (ch === '{' || ch === '[') this.open(ch);
    else if (ch === '"') {
      this.string = true;
      this.expect = 'separator';
    } else if (/[tfn0-9-]/.test(ch)) this.atom = ch;
    else return false;
    return true;
  }
}
