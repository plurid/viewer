import {
  promptHistoryEntrySchema,
  type PromptHistoryEntry,
} from '../../domain/command-line/prompt';
import { getState, savePatch } from '../state/core';

export function rememberPrompt(input: Omit<PromptHistoryEntry, 'at'>): void {
  const parsed = promptHistoryEntrySchema.safeParse({ ...input, at: Date.now() });
  if (!parsed.success) return;
  const value = parsed.data;
  savePatch({
    promptHistory: [
      value,
      ...(getState().saved.promptHistory ?? []).filter(
        (item) => item.prompt !== value.prompt || item.line !== value.line,
      ),
    ].slice(0, 20),
  });
}
export function clearPromptHistory(): void {
  savePatch({ promptHistory: [] });
}
