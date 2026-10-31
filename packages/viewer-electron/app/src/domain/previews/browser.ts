import { z } from 'zod';

export function browserAddress(input: string): string {
  const value = input.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value);
  const hostPort = /^[a-z\d.-]+:\d+(?:[/?#]|$)/i.test(value);
  const url = new URL(
    local
      ? `http://${value}`
      : hostPort || !/^[a-z][a-z\d+.-]*:/i.test(value)
        ? `https://${value}`
        : value,
  );
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Enter an HTTP or HTTPS address without embedded credentials.');
  return url.href;
}
/** The identity a page sees: Chromium's own, without the app's and Electron's tokens, which some
 * sites refuse ("WhatsApp works with Google Chrome 100+"). */
export function chromeUserAgent(agent: string, appName: string): string {
  const app = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return agent
    .replace(new RegExp(` (?:Electron|${app})/\\S+`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
}
const id = z.string().min(1).max(200);
const coordinate = z.number().finite().min(-100_000).max(100_000);
const size = z.number().int().min(160).max(2048);
const modifiers = z.number().int().min(0).max(15).default(0);
const browserInput = z.discriminatedUnion('type', [
  z
    .object({
      type: z.enum(['mousePressed', 'mouseReleased', 'mouseMoved']),
      x: coordinate,
      y: coordinate,
      button: z.enum(['left', 'right', 'middle', 'none']),
      buttons: z.number().int().min(0).max(31),
      clickCount: z.number().int().min(0).max(3),
      modifiers,
    })
    .strict(),
  z
    .object({
      type: z.literal('mouseWheel'),
      x: coordinate,
      y: coordinate,
      deltaX: coordinate,
      deltaY: coordinate,
      modifiers,
    })
    .strict(),
  z
    .object({
      type: z.enum(['keyDown', 'keyUp']),
      key: z.string().max(64),
      code: z.string().max(64),
      windowsVirtualKeyCode: z.number().int().min(0).max(65535),
      modifiers,
    })
    .strict(),
  z.object({ type: z.literal('text'), text: z.string().max(100_000) }).strict(),
  z
    .object({
      type: z.literal('composition'),
      text: z.string().max(10000),
      selectionStart: z.number().int().min(0).max(10000),
      selectionEnd: z.number().int().min(0).max(10000),
    })
    .strict(),
]);
export const browserRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('open'),
      id,
      url: z.string().max(8192).transform(browserAddress),
      width: size,
      height: size,
      texture: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('navigate'),
      id,
      url: z.string().max(8192).transform(browserAddress),
    })
    .strict(),
  z
    .object({ kind: z.literal('viewport'), id, width: size, height: size, visible: z.boolean() })
    .strict(),
  z
    .object({
      kind: z.literal('action'),
      id,
      action: z.enum([
        'back',
        'forward',
        'reload',
        'stop',
        'external',
        'native-window',
        'zoom-in',
        'zoom-out',
        'zoom-reset',
        'copy',
        'paste',
        'cut',
        'select-all',
      ]),
    })
    .strict(),
  z.object({ kind: z.literal('input'), id, event: browserInput }).strict(),
  z.object({ kind: z.enum(['close', 'state']), id }).strict(),
]);
export type BrowserRequest = z.input<typeof browserRequestSchema>;
export interface BrowserSnapshot {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  back: boolean;
  forward: boolean;
  zoom: number;
  transport: 'texture' | 'bitmap';
  error?: string;
}
