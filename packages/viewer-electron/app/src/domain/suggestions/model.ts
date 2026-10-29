import { z } from 'zod';

/**
 * MODEL SUGGESTIONS: with Settings → Browsing → Let the model suggest actions, the prompt model
 * picks commands for the kinds of file in a folder. It receives the folder's name, a few names of
 * each kind and the commands that apply to them; it returns ids from those, with a reason each.
 * The answer is kept for the folder, so a menu reads it without waiting.
 */
const command = z.object({ id: z.string().min(1).max(200), label: z.string().max(200) }).strict();
export const modelSuggestionRequestSchema = z
  .object({
    folder: z.string().min(1).max(255),
    kinds: z
      .array(
        z
          .object({
            /** As `selectionKind` gives it: an extension, "folder", or "family:image". */
            kind: z.string().min(1).max(80),
            count: z.number().int().positive(),
            names: z.array(z.string().min(1).max(255)).min(1).max(8),
            commands: z.array(command).min(1).max(40),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type ModelSuggestionRequest = z.infer<typeof modelSuggestionRequestSchema>;

export const modelSuggestionAnswerSchema = z
  .object({
    kinds: z
      .array(
        z
          .object({
            kind: z.string().max(80),
            commands: z
              .array(
                z
                  .object({
                    id: z.string().max(200).describe('An id from that kind’s commands.'),
                    reason: z
                      .string()
                      .max(200)
                      .describe('Why, in a few words a person reads beside the command.'),
                  })
                  .strict(),
              )
              .max(4),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type ModelSuggestionAnswer = z.infer<typeof modelSuggestionAnswerSchema>;

export interface ModelPick {
  id: string;
  reason: string;
}
export interface ModelSuggestions {
  /** The provider's name, shown beside its picks. */
  provider: string;
  picks: Record<string, ModelPick[]>;
}

export const modelSuggestionInstructions = `Suggest file actions for a folder.
For each kind of file, choose at most two of that kind's commands that a person is most likely
to want for files like these names, best first, with a reason of at most six words.
Leave a kind out when nothing fits. Use only the ids given for that kind.`;

/** The picks a menu may show: ids offered for the kind, two per kind, reasons trimmed. */
export function modelPicks(
  request: ModelSuggestionRequest,
  answer: ModelSuggestionAnswer,
): Record<string, ModelPick[]> {
  const offered = new Map(
    request.kinds.map((kind) => [kind.kind, new Set(kind.commands.map((item) => item.id))]),
  );
  const picks: Record<string, ModelPick[]> = {};
  for (const kind of answer.kinds) {
    const ids = offered.get(kind.kind);
    if (!ids || picks[kind.kind]) continue;
    const chosen = kind.commands
      .filter(
        (item, index, all) =>
          ids.has(item.id) && all.findIndex((other) => other.id === item.id) === index,
      )
      .slice(0, 2)
      .map((item) => ({
        id: item.id,
        reason: item.reason.trim().replace(/\s+/g, ' ').slice(0, 60),
      }));
    if (chosen.length) picks[kind.kind] = chosen;
  }
  return picks;
}
