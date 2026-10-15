import { mkdir, open, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BrowserWindow, Display, Rectangle } from 'electron';
import { z } from 'zod';
import { discardOwnTemporaryFile } from './removal';

const rectangle = z.object({
  x: z.number().int().min(-1000000).max(1000000),
  y: z.number().int().min(-1000000).max(1000000),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
});
const schema = z.object({
  version: z.literal(1),
  bounds: rectangle,
  maximized: z.boolean(),
  fullscreen: z.boolean(),
  display: z.object({ id: z.number().int(), workArea: rectangle }),
});
export type WindowFrame = z.infer<typeof schema>;
type Monitor = Pick<Display, 'id' | 'workArea'>;

export function restoreWindowFrame(
  saved: WindowFrame | null,
  displays: readonly Monitor[],
  primary: Monitor,
) {
  const remembered = saved && displays.find((display) => display.id === saved.display.id);
  const area = (remembered || primary).workArea;
  const minWidth = Math.min(780, area.width);
  const minHeight = Math.min(560, area.height);
  const previous = saved && remembered ? saved.bounds : null;
  const filled =
    previous &&
    ['x', 'y', 'width', 'height'].every(
      (key) =>
        Math.abs(
          previous[key as keyof Rectangle] - saved!.display.workArea[key as keyof Rectangle],
        ) <= 2,
    );
  const width = filled
    ? area.width
    : Math.min(area.width, Math.max(minWidth, saved?.bounds.width ?? 1440));
  const height = filled
    ? area.height
    : Math.min(area.height, Math.max(minHeight, saved?.bounds.height ?? 940));
  const x = previous
    ? previous.x + area.x - saved!.display.workArea.x
    : area.x + Math.round((area.width - width) / 2);
  const y = previous
    ? previous.y + area.y - saved!.display.workArea.y
    : area.y + Math.round((area.height - height) / 2);
  return {
    bounds: {
      x: filled ? area.x : Math.max(area.x, Math.min(x, area.x + area.width - width)),
      y: filled ? area.y : Math.max(area.y, Math.min(y, area.y + area.height - height)),
      width,
      height,
    },
    minWidth,
    minHeight,
    maximized: saved?.maximized ?? false,
    fullscreen: saved?.fullscreen ?? false,
  };
}

export function captureWindowFrame(
  window: Pick<
    BrowserWindow,
    'isMinimized' | 'isMaximized' | 'isFullScreen' | 'getBounds' | 'getNormalBounds'
  >,
  display: Monitor,
): WindowFrame | null {
  if (window.isMinimized()) return null;
  const maximized = window.isMaximized(),
    fullscreen = window.isFullScreen();
  const value = schema.safeParse({
    version: 1,
    bounds: maximized || fullscreen ? window.getNormalBounds() : window.getBounds(),
    maximized,
    fullscreen,
    display: { id: display.id, workArea: display.workArea },
  });
  return value.success ? value.data : null;
}

export class WindowState {
  value: WindowFrame | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  private persistedText?: string;
  constructor(readonly file: string) {}
  async load(): Promise<void> {
    this.value = null;
    this.persistedText = undefined;
    try {
      // Bound the read itself: damaged placement files must not slow startup.
      const handle = await open(this.file, 'r');
      const buffer = Buffer.alloc(65537);
      let length = 0;
      try {
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
      } finally {
        await handle.close();
      }
      if (length > 65536) return;
      const parsed = schema.safeParse(JSON.parse(buffer.toString('utf8', 0, length)));
      this.value = parsed.success ? parsed.data : null;
      if (this.value) this.persistedText = JSON.stringify(this.value);
    } catch {
      // Window placement is optional and must never prevent startup or recovery.
      this.value = null;
    }
  }
  remember(frame: WindowFrame | null): void {
    if (!frame || JSON.stringify(frame) === JSON.stringify(this.value)) return;
    this.value = schema.parse(frame);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.write().catch((error) => console.error('Window placement save failed', error));
    }, 250);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.writes.catch(() => undefined);
    // Retry a failed background save at close, even if the frame hasn't changed.
    if (this.value && JSON.stringify(this.value) !== this.persistedText) await this.write();
  }
  private write(): Promise<void> {
    const text = JSON.stringify(this.value);
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(text);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, this.file);
          this.persistedText = text;
        } finally {
          await discardOwnTemporaryFile(temporary);
        }
      });
    return this.writes;
  }
}
