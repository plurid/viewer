import { taskWorkflowInputSchema, type TaskWorkflowInput } from '../agents/task-workflow';
import { LineError, type Word } from './lex';

export type TaskWorkflowDraft = Partial<TaskWorkflowInput>;
const valueOptions = ['repo', 'path', 'branch', 'base', 'workspace'] as const;
type ValueOption = (typeof valueOptions)[number];

/** Turn words into form values, never a process command. Omitted values stay editable;
 * paths are resolved once in the originating plane before the form opens. */
export function taskLineDraft(
  words: readonly Word[],
  resolve?: (word: Word) => string,
): TaskWorkflowDraft {
  const draft: TaskWorkflowDraft = {},
    names: string[] = [],
    used = new Set<string>();
  let options = false;
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (!word.quoted && word.text.startsWith('--')) {
      options = true;
      const key = word.text.slice(2);
      if (used.has(key)) throw new LineError(`Task option --${key} is repeated.`, word.at);
      used.add(key);
      if (key === 'existing') {
        draft.existing = true;
        continue;
      }
      if (!valueOptions.includes(key as ValueOption))
        throw new LineError(`Unknown task option --${key}.`, word.at);
      const value = words[++index];
      if (!value || (!value.quoted && value.text.startsWith('--')))
        throw new LineError(`--${key} needs a value.`, word.end);
      const option = key as ValueOption;
      const text =
        (option === 'repo' || option === 'path') && resolve ? resolve(value) : value.text;
      const valid =
        option === 'repo' || option === 'path'
          ? text.length > 0 && text.length <= 32768 && !text.includes('\0')
          : taskWorkflowInputSchema.shape[option].safeParse(text).success;
      if (!valid) throw new LineError(`Use a valid value for --${key}.`, value.at);
      draft[option] = text;
    } else {
      if (options)
        throw new LineError(
          'Put the task name before its --options; quote names and paths containing spaces.',
          word.at,
        );
      names.push(word.text);
    }
  }
  if (names.length) {
    const name = taskWorkflowInputSchema.shape.name.safeParse(names.join(' '));
    if (!name.success)
      throw new LineError('Use a task name of 1–100 ordinary characters.', words[0]!.at);
    draft.name = name.data;
  }
  if (draft.existing && draft.base)
    throw new LineError('Choose --existing or --base, not both.', words[0]?.at ?? 0);
  return draft;
}
