/** Runs at most `size` pieces of work at once; the rest wait their turn in order. */
export class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly size: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((turn) => this.waiting.push(turn));
    else this.active++;
    try {
      return await work();
    } finally {
      // hand the slot straight to the next in line, so a newcomer cannot take it first
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
