/**
 * Asks the Meta Model API what it accepts, before Viewer depends on it: the models, a text reply, an
 * image part, several images, strict JSON schema output, the reply envelope and SAM 3.1 on the
 * Responses API. The key comes from META_API_KEY and is never printed; nothing is written.
 *
 *   META_API_KEY=… node --import tsx tools/meta-probe.ts [--model <id>] [--base <url>]
 */
import { deflateSync } from 'node:zlib';

const argument = (name: string) => {
  const index = process.argv.indexOf('--' + name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const key = process.env.META_API_KEY;
const base = (argument('base') ?? process.env.META_API_BASE ?? 'https://api.meta.ai/v1').replace(
  /\/+$/,
  '',
);
if (!key) throw new Error('Set META_API_KEY in the environment; the probe never prints it.');

/** A square of one colour on white, as a PNG data URL: enough to see whether images reach the model. */
function square(red: number, green: number, blue: number, size = 64): string {
  const row = (y: number) =>
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from(
        Array.from({ length: size }, (_, x) =>
          x > 15 && x < 48 && y > 15 && y < 48 ? [red, green, blue] : [255, 255, 255],
        ).flat(),
      ),
    ]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, (_, y) => row(y))));
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  }).catch((error: Error) => ({ error }));
  const milliseconds = Math.round(performance.now() - started);
  if ('error' in response) return { status: 0, milliseconds, error: response.error.message };
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, milliseconds, json, text: text.slice(0, 400) };
}

/** The reply text, from an OpenAI-style or a Llama-style envelope, and which one it was. */
function reply(json: unknown): { envelope: string; text?: string } {
  const value = json as {
    choices?: { message?: { content?: unknown } }[];
    completion_message?: { content?: { text?: string } | string };
  };
  const content = value?.choices?.[0]?.message?.content;
  if (content !== undefined)
    return { envelope: 'choices[0].message.content', text: String(content) };
  const completion = value?.completion_message?.content;
  if (completion !== undefined)
    return {
      envelope: 'completion_message.content',
      text: typeof completion === 'string' ? completion : completion.text,
    };
  return { envelope: 'unknown: ' + Object.keys(value ?? {}).join(', ') };
}

const report = (label: string, result: Awaited<ReturnType<typeof call>>, detail = '') =>
  console.log(
    `${result.status >= 200 && result.status < 300 ? 'OK  ' : 'FAIL'} ${label} · ${result.status} · ${result.milliseconds} ms` +
      (detail ? ' · ' + detail : '') +
      (result.status >= 300 || !result.status
        ? ' · ' + (result.error ?? result.text ?? '').replace(/\s+/g, ' ')
        : ''),
  );

const models = await call('GET', '/models');
const ids = ((models.json as { data?: { id: string }[] })?.data ?? []).map((model) => model.id);
report('models', models, ids.length ? ids.join(', ') : '');
const model =
  argument('model') ?? ids.find((id) => /spark/i.test(id) && !/open/i.test(id)) ?? ids[0];
if (!model) throw new Error('No model to try. Pass --model <id>.');
console.log('Using model', model);

const text = await call('POST', '/chat/completions', {
  model,
  messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
});
const said = reply(text.json);
report('text', text, `${said.envelope} → ${JSON.stringify(said.text?.slice(0, 60))}`);

const image = await call('POST', '/chat/completions', {
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What colour is the square? Answer with one word.' },
        { type: 'image_url', image_url: { url: square(220, 30, 30) } },
      ],
    },
  ],
});
const seen = reply(image.json).text ?? '';
report(
  'one image',
  image,
  `answer ${JSON.stringify(seen.slice(0, 40))}, red seen: ${/red/i.test(seen)}`,
);

const several = await call('POST', '/chat/completions', {
  model,
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Name the colour of the square in each image, in order, comma separated.',
        },
        ...[
          [220, 30, 30],
          [30, 160, 40],
          [30, 60, 220],
          [240, 200, 20],
        ].map(([r, g, b]) => ({ type: 'image_url', image_url: { url: square(r!, g!, b!) } })),
      ],
    },
  ],
});
report('four images', several, JSON.stringify((reply(several.json).text ?? '').slice(0, 80)));

const schema = {
  type: 'object',
  properties: { thickness_mm: { type: 'number' }, pieces: { type: 'integer' } },
  required: ['thickness_mm', 'pieces'],
  additionalProperties: false,
};
const strict = await call('POST', '/chat/completions', {
  model,
  messages: [
    {
      role: 'user',
      content: 'The laser file is named g6-TP38-EM2-4buc.dxf: g6 is 6 mm, 4buc is 4 pieces.',
    },
  ],
  response_format: { type: 'json_schema', json_schema: { name: 'part', schema, strict: true } },
});
report('json_schema strict', strict, JSON.stringify((reply(strict.json).text ?? '').slice(0, 80)));
if (strict.status >= 300) {
  const loose = await call('POST', '/chat/completions', {
    model,
    messages: [
      {
        role: 'user',
        content:
          'Answer as JSON {"thickness_mm": number, "pieces": integer}. File: g6-TP38-EM2-4buc.dxf (g6 = 6 mm, 4buc = 4 pieces).',
      },
    ],
    response_format: { type: 'json_object' },
  });
  report('json_object', loose, JSON.stringify((reply(loose.json).text ?? '').slice(0, 80)));
}

// SAM is served only by the Responses API; its reply is text with box and mask tokens.
const sam = ids.find((id) => /^sam/i.test(id)) ?? 'sam-3.1';
const segment = await call('POST', '/responses', {
  model: sam,
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'red square' },
        { type: 'input_image', image_url: square(220, 30, 30) },
      ],
    },
  ],
  metadata: { mask_encoding: 'one_bit' },
});
const segmented =
  (segment.json as { output?: { content?: { text?: string }[] }[] })?.output?.[0]?.content?.[0]
    ?.text ?? '';
const box = /<\|box;([^|]*)\|>/.exec(segmented)?.[1];
report(
  'SAM ' + sam,
  segment,
  box ? `box ${box}, mask ${segmented.includes('<|mask;')}` : 'no box in the reply',
);
