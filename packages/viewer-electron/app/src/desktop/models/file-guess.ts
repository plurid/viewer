import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FileGuess } from '../../domain/files/file-guess';
import {
  fileGuess,
  fileGuessAnswerSchema,
  fileGuessInput,
  fileGuessInstructions,
  fileGuessProbe,
} from '../../domain/files/file-guess';
import { identifyBytes } from '../../domain/files/signatures';
import type { ApplicationSettings } from '../../domain/services';
import type { Providers } from './providers';
import { promptProvider } from './prompts';

type Generate = Providers['generate'];
type Access = (files: readonly string[]) => Promise<void>;

const answerSchema = z.toJSONSchema(fileGuessAnswerSchema);

/** A file's size and first bytes: a link is resolved and checked, then the file is opened
 * without following one, so a swapped link cannot point the read elsewhere. */
async function readHead(file: string, access: Access) {
  await access([file]);
  const actual = await realpath(file);
  await access([actual]);
  const handle = await open(
    actual,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Choose a regular file to identify.');
    const head = Buffer.alloc(Math.min(info.size, fileGuessProbe));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return { head: head.subarray(0, bytesRead), size: info.size };
  } finally {
    await handle.close();
  }
}

/**
 * The prompt model's guess at a file, at the "excerpts" level: its first bytes are content.
 * Without that permission the provider refuses before anything is sent.
 */
export async function guessFile(
  file: string,
  settings: ApplicationSettings,
  generate: Generate,
  access: Access,
  signal: AbortSignal,
): Promise<FileGuess> {
  const provider = promptProvider(settings);
  if (!provider) throw new Error('Add a model in Settings → Models.');
  const { head, size } = await readHead(file, access);
  const name = path.basename(file);
  const raw = await generate(
    provider,
    fileGuessInstructions,
    fileGuessInput(name, size, head, identifyBytes(head, name)),
    answerSchema,
    signal,
    'excerpts',
    'user',
  );
  const parsed = fileGuessAnswerSchema.safeParse(raw);
  const guess = parsed.success ? fileGuess(provider.name, parsed.data) : undefined;
  if (!guess) throw new Error('The model returned an invalid answer. Try again.');
  return guess;
}
