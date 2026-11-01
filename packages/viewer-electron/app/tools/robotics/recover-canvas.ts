import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { chatStepSchema } from '../../src/domain/models/chat';
import { Canvases } from '../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import {
  digest,
  fingerprint,
  readEvidence,
  requireReview,
  reviewToken,
  saveEvidence,
  verifyRobotRehearsal,
} from './rehearsal';
import { robotRehearsalStatus, robotSessionResultSchema } from './rehearsal-session';

const envelopeSchema = z.object({
  status: z.literal(200),
  envelope: z.object({
    choices: z
      .array(
        z.object({
          finish_reason: z.literal('tool_calls'),
          message: z.object({
            role: z.literal('assistant'),
            tool_calls: z
              .array(
                z.object({
                  type: z.literal('function'),
                  function: z.object({ name: z.literal('viewer_step'), arguments: z.string() }),
                }),
              )
              .length(1),
          }),
        }),
      )
      .length(1),
  }),
});

/** Apply an intact rejected canvas after a parser fix, without asking the provider to regenerate it. */
export async function recoverRobotCanvas(root: string, reviewed: string) {
  await verifyRobotRehearsal(root);
  const history = await robotRehearsalStatus(root);
  const failed = history.at(-1);
  if (
    !failed ||
    failed.result.status !== 'failed' ||
    failed.result.recovery ||
    !failed.result.conversation ||
    !failed.result.canvas
  )
    throw new Error(
      'Recover only the latest failed session with retained conversation and canvas.',
    );
  const profile = path.join(root, 'Profile');
  const canvases = new Canvases(profile, { changed: () => {} });
  const documents = new ChatDocumentStore(
    path.join(profile, 'chat-documents', failed.result.conversation.id + '.json'),
  );
  const conversation = await documents.load();
  const current = await canvases.read(1, failed.result.canvas.id);
  if (
    !conversation ||
    fingerprint(conversation) !== fingerprint(failed.result.conversation) ||
    fingerprint(current) !== fingerprint(failed.result.canvas)
  )
    throw new Error('The failed conversation or canvas changed. Inspect it before recovery.');
  requireReview(reviewed, conversation, current);
  const requests = (await readdir(failed.folder))
    .filter((name) => /^request-\d{2}\.json$/.test(name))
    .sort();
  const last = requests.at(-1);
  if (!last) throw new Error('No retained provider request.');
  const response = last.replace('.json', '-response.json');
  const bytes = await readEvidence(path.join(failed.folder, response));
  const raw = envelopeSchema.parse(JSON.parse(bytes.toString('utf8')));
  const step = chatStepSchema.parse(
    JSON.parse(raw.envelope.choices[0]!.message.tool_calls[0]!.function.arguments),
  );
  if (step.kind !== 'canvas_write' || Number(step.commandID) !== current.revision)
    throw new Error('The saved response must be a canvas write for the unchanged revision.');
  const recovery = {
    kind: 'saved-provider-canvas' as const,
    response,
    responseHash: digest(bytes),
  };
  await saveEvidence(path.join(failed.folder, 'recovery-started.json'), {
    recovery,
    reviewed,
    at: Date.now(),
  });
  const canvas = await canvases.write(
    1,
    current.id,
    current.revision,
    step.query || current.title,
    step.text,
    Object.fromEntries(step.patches.map((patch) => [patch.path, patch.value])),
  );
  await canvases.flush();
  const recoveredConversation = {
    ...conversation,
    revision: conversation.revision + 1,
    updated: Date.now(),
    status: 'idle' as const,
    error: undefined,
    messages: [
      ...conversation.messages,
      {
        id: randomUUID(),
        role: 'tool' as const,
        at: Date.now(),
        text: JSON.stringify({
          recovery:
            'Applied the unmodified saved provider canvas after parser correction. No new provider request or final assistant reply was generated.',
          revision: canvas.revision,
          responseHash: recovery.responseHash,
        }),
      },
    ],
  };
  await documents.save(recoveredConversation);
  const result = robotSessionResultSchema.parse({
    ...failed.result,
    status: 'generated',
    failure: undefined,
    recovery,
    conversation: recoveredConversation,
    canvas,
    reviewToken: undefined,
  });
  result.reviewToken = reviewToken(result.conversation!, result.canvas!);
  await saveEvidence(path.join(failed.folder, 'recovered-result.json'), result);
  return { folder: failed.folder, result };
}
