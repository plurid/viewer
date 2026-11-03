import type { ChatMessage } from '../../domain/models/chat';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const pointerKey = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** Only identical snapshot data is referenced; earlier values and measured results stay intact. */
function reference(value: unknown, current: unknown, pointer: string): unknown {
  const encoded = JSON.stringify(value);
  if (encoded && encoded.length >= 1024 && encoded === JSON.stringify(current))
    return { $viewerContext: pointer };
  if (Array.isArray(value) && Array.isArray(current))
    return value.map((item, index) => reference(item, current[index], pointer + '/' + index));
  if (record(value) && record(current))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        reference(item, current[key], pointer + '/' + pointerKey(key)),
      ]),
    );
  return value;
}

export function canvasModelMessages(
  messages: readonly ChatMessage[],
  canvas: Record<string, unknown> | null,
  paired: ReadonlySet<string>,
): ChatMessage[] {
  return messages
    .filter((message) => !paired.has(message.id))
    .map((message) => {
      if (!canvas || message.role !== 'tool') return message;
      let result: unknown;
      try {
        result = JSON.parse(message.text);
      } catch {
        return message;
      }
      if (!record(result) || !Number.isInteger(result.revision)) return message;
      const snapshot =
        typeof result.id === 'string' &&
        typeof result.html === 'string' &&
        Array.isArray(result.sources) &&
        Array.isArray(result.assets);
      const saved = typeof result.canvasID === 'string' && record(result.savedState);
      if (!snapshot && !saved) return message;
      const fields: Record<string, string> = {
        html: 'html',
        state: 'state',
        savedState: 'state',
        defaults: 'defaults',
        sources: 'sources',
        assets: 'assets',
      };
      const projected = Object.fromEntries(
        Object.entries(result).map(([key, value]) => [
          key,
          fields[key] && canvas[fields[key]] !== undefined
            ? reference(value, canvas[fields[key]], '#/canvas/' + fields[key])
            : value,
        ]),
      );
      return { ...message, text: JSON.stringify(projected) };
    });
}
