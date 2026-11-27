/** Only an open JSON string can continue beyond this physical record. */
export class WorkerJsonValue {
  private depth = 0;
  private string = false;
  private escape = false;

  constructor(open: string) {
    this.scan(open);
  }

  get quoted(): boolean {
    return this.string;
  }

  scan(ch: string): boolean {
    if (this.string) {
      if (this.escape) this.escape = false;
      else if (ch === '\\') this.escape = true;
      else if (ch === '"') this.string = false;
    } else if (ch === '"') this.string = true;
    else if (ch === '{' || ch === '[') this.depth++;
    else if (ch === '}' || ch === ']') this.depth--;
    return this.string || this.depth > 0;
  }

  finishLine(): boolean {
    this.depth = 0;
    this.escape = false;
    return this.string;
  }
}
