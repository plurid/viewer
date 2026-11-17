export const terminalCommandLimit = 1000;

function invisibleCommandText(value: string): boolean {
  const characters = [...value];
  const emoji = (character: string | undefined) => !!character && /\p{Emoji}/u.test(character);
  const pictographic = (character: string | undefined) =>
    !!character && /\p{Extended_Pictographic}/u.test(character);
  const selector = (character: string | undefined) =>
    character === '\uFE0E' || character === '\uFE0F';
  return characters.some((character, index) => {
    if (selector(character) && emoji(characters[index - 1])) return false;
    if (character === '\u200D') {
      let previous = index - 1;
      if (characters[previous] && /\p{Emoji_Modifier}/u.test(characters[previous]!)) previous--;
      if (selector(characters[previous])) previous--;
      if (pictographic(characters[previous]) && pictographic(characters[index + 1])) return false;
    }
    return /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(character);
  });
}

/** Typed completion and invisible formatting can make a shell run text different from the review. */
export function validTerminalCommand(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= terminalCommandLimit &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) &&
    !invisibleCommandText(value)
  );
}

export function terminalCommandProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'Use command text.';
  if (/[\r\n\p{Zl}\p{Zp}]/u.test(value)) return 'Keep the command on one line.';
  if (value.includes('\t'))
    return 'Remove tabs from the command: a typed tab triggers shell completion.';
  if (/\p{Cc}/u.test(value)) return 'Remove control characters from the command.';
  if (invisibleCommandText(value))
    return 'Remove invisible formatting characters from the command.';
  if (/\p{Cs}/u.test(value)) return 'Remove unpaired Unicode surrogates from the command.';
  return undefined;
}
