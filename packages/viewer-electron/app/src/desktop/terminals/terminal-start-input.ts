export const heldTerminalInputLimit = 64 * 1024;

type HeldInputResult = 'held' | 'overflow';
type InputDisposition = 'pass' | 'drop' | 'hold';
type StringIntroducer = ']' | 'P';

/** xterm sends both terminal reports and human input through terminalWrite. */
export class TerminalStartInput {
  private writes: string[] = [];
  private characters = 0;
  private sequence = '';
  private outputSequence = '';
  private outputDiscarding?: StringIntroducer;
  private queries = new Map<string, number>();
  private dcsWaiting = false;
  private pasteMode = false;
  private focusMode = false;

  get bracketedPaste(): boolean {
    return this.pasteMode;
  }

  get waiting(): boolean {
    return this.dcsWaiting || this.queries.size > 0;
  }

  observeOutput(data: string): void {
    let input = this.outputSequence + data;
    this.outputSequence = '';
    if (this.outputDiscarding) {
      const end = sequenceEnd('\x1b' + this.outputDiscarding + input, 0);
      if (end === undefined) {
        this.outputSequence = input.endsWith('\x1b') ? '\x1b' : '';
        return;
      }
      input = input.slice(end - 2);
      this.outputDiscarding = undefined;
    }
    let offset = input.indexOf('\x1b');
    while (offset >= 0) {
      const end = sequenceEnd(input, offset);
      if (end === undefined) {
        const remainder = input.slice(offset);
        if (remainder.length <= 4096) this.outputSequence = remainder;
        else if (remainder[1] === ']' || remainder[1] === 'P') {
          this.outputDiscarding = remainder[1];
          this.outputSequence = remainder.endsWith('\x1b') ? '\x1b' : '';
        }
        return;
      }
      const sequence = input.slice(offset, end);
      if (decrqssQuery(sequence)) this.dcsWaiting = true;
      if (sequence === '\x1b[?2004h') {
        this.pasteMode = true;
        this.dcsWaiting = false;
      }
      if (sequence === '\x1b[?2004l') this.pasteMode = false;
      if (sequence === '\x1b[?1004h') this.focusMode = true;
      if (sequence === '\x1b[?1004l') this.focusMode = false;
      const key = queryKey(sequence);
      if (key && this.queries.size < 4096)
        this.queries.set(key, Math.min(4096, (this.queries.get(key) ?? 0) + 1));
      offset = input.indexOf('\x1b', end);
    }
  }

  write(data: string, report: (data: string) => void): HeldInputResult {
    const input = this.sequence + data;
    this.sequence = '';
    let offset = 0;
    while (offset < input.length) {
      if (input[offset] !== '\x1b') {
        const next = input.indexOf('\x1b', offset);
        const end = next < 0 ? input.length : next;
        if (!this.hold(input.slice(offset, end))) {
          this.sequence = input.slice(offset);
          return 'overflow';
        }
        offset = end;
        continue;
      }
      const end = sequenceEnd(input, offset);
      if (end === undefined) {
        this.sequence = input.slice(offset);
        return this.characters + this.sequence.length <= heldTerminalInputLimit
          ? 'held'
          : 'overflow';
      }
      const sequence = input.slice(offset, end);
      const disposition = this.disposition(sequence);
      if (disposition === 'pass') report(sequence);
      else if (disposition === 'hold' && !this.hold(sequence)) {
        this.sequence = input.slice(offset);
        return 'overflow';
      }
      offset = end;
    }
    return 'held';
  }

  take(): string[] {
    const writes = [...this.writes, ...(this.sequence ? [this.sequence] : [])];
    this.writes = [];
    this.sequence = '';
    this.characters = 0;
    return writes;
  }

  private hold(data: string): boolean {
    const size = data.length;
    if (this.characters + size > heldTerminalInputLimit) return false;
    if (data) this.writes.push(data);
    this.characters += size;
    return true;
  }

  private disposition(sequence: string): InputDisposition {
    // Even genuine DECRQSS replies can invoke history search in a shell's line editor.
    if (dcsReport(sequence)) return 'drop';
    const key = reportKey(sequence);
    if (!key) return 'hold';
    if (key === 'focus') return this.focusMode ? 'pass' : 'drop';
    const count = this.queries.get(key) ?? 0;
    // A late or pasted report must not become shell input when queued keystrokes are released.
    if (!count) return 'drop';
    if (count === 1) this.queries.delete(key);
    else this.queries.set(key, count - 1);
    return 'pass';
  }
}

function sequenceEnd(input: string, start: number): number | undefined {
  const introducer = input[start + 1];
  if (introducer === undefined) return undefined;
  if (introducer === '\x1b') return start + 1;
  if (introducer === '[') {
    for (let index = start + 2; index < input.length; index++) {
      const code = input.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return undefined;
  }
  if (introducer === ']' || introducer === 'P') {
    for (let index = start + 2; index < input.length; index++) {
      if (introducer === ']' && input[index] === '\x07') return index + 1;
      if (input[index] === '\x1b' && input[index + 1] === '\\') return index + 2;
    }
    return undefined;
  }
  return start + 2;
}

function dcsReport(sequence: string): boolean {
  return (
    sequence.startsWith('\x1bP') &&
    sequence.endsWith('\x1b\\') &&
    /^[01]\$r[\u0020-\u007e]*$/.test(sequence.slice(2, -2))
  );
}

function decrqssQuery(sequence: string): boolean {
  return (
    sequence.startsWith('\x1bP') &&
    sequence.endsWith('\x1b\\') &&
    /^\$q[\u0020-\u007e]*$/.test(sequence.slice(2, -2))
  );
}

function stringPayload(sequence: string): string | undefined {
  if (sequence.endsWith('\x1b\\')) return sequence.slice(2, -2);
  if (sequence.endsWith('\x07')) return sequence.slice(2, -1);
  return undefined;
}

function queryKey(sequence: string): string | undefined {
  if (sequence.startsWith('\x1b[')) {
    const payload = sequence.slice(2);
    if (/^\??6n$/.test(payload)) return 'cursor:' + (payload.startsWith('?') ? '?' : '');
    if (/^>?0?c$/.test(payload)) return 'attributes:' + (payload.startsWith('>') ? '>' : '?');
    const mode = /^\?(\d+)\$p$/.exec(payload);
    if (mode) return 'mode:' + Number(mode[1]);
    if (payload === '5n') return 'status';
    if (payload === '18t') return 'size';
  }
  const payload = stringPayload(sequence);
  if (payload === undefined) return undefined;
  if (sequence.startsWith('\x1b]')) {
    const color = /^(4;\d+|10|11|12);\?$/.exec(payload);
    if (color) return 'color:' + color[1];
  }
  return undefined;
}

function reportKey(sequence: string): string | undefined {
  if (sequence.startsWith('\x1b[')) {
    const payload = sequence.slice(2);
    if (/^\??\d+;\d+R$/.test(payload)) return 'cursor:' + (payload.startsWith('?') ? '?' : '');
    if (/^[?>]\d+(?:;\d+)*c$/.test(payload)) return 'attributes:' + payload[0];
    const mode = /^\?(\d+);[0-4]\$y$/.exec(payload);
    if (mode) return 'mode:' + Number(mode[1]);
    if (/^[IO]$/.test(payload)) return 'focus';
    if (payload === '0n') return 'status';
    if (/^8;\d+;\d+t$/.test(payload)) return 'size';
  }
  if (sequence.startsWith('\x1b]')) {
    const payload = stringPayload(sequence);
    const color =
      payload &&
      /^(4;\d+|10|11|12);rgb:[\da-fA-F]{1,4}\/[\da-fA-F]{1,4}\/[\da-fA-F]{1,4}$/.exec(payload);
    if (color) return 'color:' + color[1];
  }
  return undefined;
}
