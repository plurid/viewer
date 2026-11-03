import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { digest, readRobotSessionResult } from './rehearsal';

const resultSchema = z.object({
  status: z.enum(['generated', 'failed', 'stopped']),
  canvasID: z.uuid(),
  canvas: canvasDocumentSchema,
});
const qualificationSchema = z.object({
  status: z.literal('passed'),
  canvasID: z.uuid(),
  revision: z.number().int().nonnegative(),
  htmlHash: z.string().regex(/^[a-f0-9]{64}$/),
  conversationStatus: z.enum(['idle', 'failed', 'stopped']),
  finalReply: z.boolean(),
  providerRequests: z.number().int().nonnegative().max(8).optional(),
});

/** Artifact acceptance and completion of the model's closing reply are separate evidence. */
export function qualifiedStationArtifact(result: unknown, qualification: unknown) {
  const saved = resultSchema.parse(result);
  const review = qualificationSchema.parse(qualification);
  if (
    saved.canvasID !== saved.canvas.id ||
    review.canvasID !== saved.canvas.id ||
    review.revision !== saved.canvas.revision ||
    review.htmlHash !== digest(saved.canvas.html)
  )
    throw new Error('The qualification does not identify the exact saved model artifact.');
  return review;
}

export async function readQualifiedStation(folder: string) {
  const result = await readRobotSessionResult(folder);
  const continuations = await readdir(path.join(folder, 'continuations')).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return [] as string[];
    },
  );
  const latest = continuations.sort().at(-1);
  const fallback = path.join(folder, 'qualification.json');
  const qualification = latest
    ? await readFile(
        path.join(folder, 'continuations', latest, 'qualification.json'),
        'utf8',
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return readFile(fallback, 'utf8');
      })
    : await readFile(fallback, 'utf8');
  return qualifiedStationArtifact(result, JSON.parse(qualification));
}
