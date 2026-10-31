/** Plain command output across PTY chunks, including split CSI and OSC sequences. */
export class CommandOutput {
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' = 'text';
  private carriage = false;

  accept(chunk: string): string {
    let output = '';
    for (const character of chunk) {
      const code = character.codePointAt(0)!;
      if (this.state === 'string-escape') {
        this.state = character === '\\' ? 'text' : 'string';
        continue;
      }
      if (this.state === 'string') {
        if (code === 7 || code === 0x9c) this.state = 'text';
        else if (code === 27) this.state = 'string-escape';
        continue;
      }
      if (this.state === 'csi') {
        if (code >= 0x40 && code <= 0x7e) this.state = 'text';
        continue;
      }
      if (this.state === 'escape') {
        if (character === '[') this.state = 'csi';
        else if (']P_^X'.includes(character)) this.state = 'string';
        else if (code < 0x20 || code > 0x2f) this.state = 'text';
        continue;
      }
      if (code === 27) this.state = 'escape';
      else if (code === 0x9b) this.state = 'csi';
      else if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) this.state = 'string';
      else if (character === '\r') {
        output += '\n';
        this.carriage = true;
      } else if (character === '\n') {
        if (!this.carriage) output += character;
        this.carriage = false;
      } else if (character === '\t' || (code >= 32 && (code < 0x7f || code > 0x9f))) {
        output += character;
        this.carriage = false;
      }
    }
    return output;
  }
}
