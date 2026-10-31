import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { reasoningEfforts } from '../../src/domain/models/providers';
import { evaluateLive } from './evaluate-live';

const retainedSchema = z.object({
  version: z.literal(1),
  model: z.string().min(1).max(200),
  effort: z.enum(reasoningEfforts).nullable(),
  repeat: z.number().int().min(1).max(3),
  retries: z.number().int().min(0).max(2),
  runs: z
    .array(
      z.object({
        job: z.string().regex(/^J[1-8]$/),
        attempts: z
          .array(
            z.object({
              calls: z
                .array(
                  z.object({
                    route: z.enum(['model', 'segmentation']),
                    status: z.number().int().min(0).max(599),
                    reply: z.string().optional(),
                    error: z.string().optional(),
                  }),
                )
                .max(100),
            }),
          )
          .max(3),
      }),
    )
    .min(1)
    .max(24),
});

/** Replays retained replies through current extraction and verification, with no network route. */
export async function replayLive(options: {
  source: string;
  out: string;
  log?(line: string): void;
}) {
  const source = path.resolve(options.source);
  const info = await stat(source);
  if (!info.isFile() || info.size > 64_000_000)
    throw new Error('The retained answers file is too large or is not a file.');
  const retained = retainedSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  const calls = retained.runs.flatMap((run) => run.attempts.flatMap((attempt) => attempt.calls));
  let next = 0;
  const request: typeof fetch = async (input) => {
    const route = String(input instanceof Request ? input.url : input).endsWith('/responses')
      ? 'segmentation'
      : 'model';
    const call = calls[next++];
    if (!call || call.route !== route)
      throw new Error(
        'The replay requested a call that the retained run does not contain. No network request was made.',
      );
    if (!call.status) throw new Error(call.error ?? 'Recorded connection failure.');
    return new Response(call.reply ?? '', {
      status: call.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  const report = await evaluateLive({
    out: options.out,
    key: 'offline-recorded-replay',
    model: retained.model,
    ...(retained.effort ? { effort: retained.effort } : {}),
    jobs: [...new Set(retained.runs.map((run) => run.job))],
    repeat: retained.repeat,
    retries: retained.retries,
    request,
    replay: { source },
    wait: async () => {},
    log: options.log,
  });
  if (next !== calls.length)
    throw new Error(
      'The replay did not consume every retained call. Its artifacts were preserved.',
    );
  return report;
}
