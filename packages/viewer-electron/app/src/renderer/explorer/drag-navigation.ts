export interface SpringPort<State, Entry> {
  read(): State | undefined;
  inspect(path: string): Promise<Entry | undefined>;
  open(entry: Entry, before: State): State | undefined;
  restore(initial: State, current: State): void;
  commit(initial: State, current: State): void;
}

/** A hover never owns a later workspace, navigation or permission change. */
export class SpringNavigation<State, Entry> {
  private initial?: State;
  private current?: State;
  private pending = false;
  private generation = 0;
  private opened = 0;
  constructor(private port: SpringPort<State, Entry>) {}
  async open(path: string, valid: () => boolean): Promise<void> {
    if (this.pending || this.opened >= 32 || !valid()) return;
    const before = this.port.read();
    if (!before || (this.current && this.current !== before)) return;
    const generation = this.generation;
    this.pending = true;
    try {
      const entry = await this.port.inspect(path);
      if (!entry || generation !== this.generation || !valid() || this.port.read() !== before)
        return;
      const next = this.port.open(entry, before);
      if (!next || next === before) return;
      this.initial ??= before;
      this.current = next;
      this.opened++;
    } finally {
      this.pending = false;
    }
  }
  finish(dropped = false): void {
    this.generation++;
    if (this.initial && this.current && this.port.read() === this.current) {
      if (dropped) this.port.commit(this.initial, this.current);
      else this.port.restore(this.initial, this.current);
    }
    this.initial = this.current = undefined;
    this.opened = 0;
  }
}

/** One attempt per stationary hover; leaving invalidates asynchronous inspection too. */
export class SpringHover {
  private path?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(
    private open: (path: string, valid: () => boolean) => Promise<void>,
    private delay = 650,
  ) {}
  hover(path?: string): void {
    if (path === this.path) return;
    this.cancel();
    this.path = path;
    if (!path) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.open(path, () => generation === this.generation && path === this.path).catch(
        () => {},
      );
    }, this.delay);
  }
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.path = undefined;
    this.generation++;
  }
}

export interface DragPoint {
  x: number;
  y: number;
}
export interface DragScrollTarget {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  scroll(x: number, y: number): void;
}
/** Speed is in layout pixels/second, independent of the plane's projected scale. */
export function edgeVelocity(position: number, size: number): number {
  if (size <= 0 || position < 0 || position > size) return 0;
  const edge = Math.min(36, size / 3);
  if (position < edge) return -600 * (1 - position / edge);
  if (position > size - edge) return 600 * (1 - (size - position) / edge);
  return 0;
}
export class DragAutoScroll {
  private point?: DragPoint;
  private frame?: number;
  private previous?: number;
  constructor(
    private targets: (point: DragPoint) => DragScrollTarget[],
    private changed: () => void,
    private request: (callback: FrameRequestCallback) => number = (callback) =>
      requestAnimationFrame(callback),
    private cancel: (frame: number) => void = (frame) => cancelAnimationFrame(frame),
  ) {}
  move(point: DragPoint): void {
    this.point = point;
    if (this.frame === undefined) this.frame = this.request(this.tick);
  }
  stop(): void {
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = this.point = this.previous = undefined;
  }
  private tick = (time: number): void => {
    this.frame = undefined;
    if (!this.point) return;
    const elapsed = Math.min(50, Math.max(0, time - (this.previous ?? time - 16))) / 1000;
    this.previous = time;
    let horizontal = false,
      vertical = false,
      moved = false;
    for (const target of this.targets(this.point)) {
      if (target.right <= target.left || target.bottom <= target.top) continue;
      const x = ((this.point.x - target.left) / (target.right - target.left)) * target.width;
      const y = ((this.point.y - target.top) / (target.bottom - target.top)) * target.height;
      if (x < 0 || x > target.width || y < 0 || y > target.height) continue;
      const dx = horizontal ? 0 : edgeVelocity(x, target.width) * elapsed;
      const dy = vertical ? 0 : edgeVelocity(y, target.height) * elapsed;
      const nextX = Math.max(
        0,
        Math.min(target.scrollWidth - target.width, target.scrollLeft + dx),
      );
      const nextY = Math.max(
        0,
        Math.min(target.scrollHeight - target.height, target.scrollTop + dy),
      );
      const movedX = nextX !== target.scrollLeft,
        movedY = nextY !== target.scrollTop;
      if (!movedX && !movedY) continue;
      target.scroll(movedX ? nextX - target.scrollLeft : 0, movedY ? nextY - target.scrollTop : 0);
      horizontal ||= movedX;
      vertical ||= movedY;
      moved = true;
    }
    if (moved) {
      this.changed();
      if (this.point) this.frame = this.request(this.tick);
    } else this.previous = undefined;
  };
}
