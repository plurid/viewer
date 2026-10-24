/** A PTY's raw byte budget is independent of renderer acknowledgements and scrollback. */
export class TerminalOutputBudget {
  private received = 0;
  private exceeded = false;

  constructor(
    private readonly limit?: number,
    private readonly readOnly = false,
  ) {}

  accept(chunk: string): { data: string; exceeded: boolean } {
    if (this.exceeded) return { data: '', exceeded: true };
    const bytes = Buffer.byteLength(chunk);
    let data = chunk;
    if (this.limit !== undefined && this.received + bytes > this.limit) {
      data = Buffer.from(chunk)
        .subarray(0, Math.max(0, this.limit - this.received))
        .toString('utf8');
      this.exceeded = true;
    }
    this.received += bytes;
    // Commit subjects and file names are untrusted. Read-only output cannot issue
    // terminal escape sequences, including OSC clipboard commands or C1 controls.
    if (this.readOnly)
      data = data.replace(
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
        (control) => `\\x${control.charCodeAt(0).toString(16).padStart(2, '0')}`,
      );
    return { data, exceeded: this.exceeded };
  }
}
