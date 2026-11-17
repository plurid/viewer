export const terminalCommandLimit = 1000;

/** Typed completion and invisible formatting can make a shell run text different from the review. */
export function validTerminalCommand(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= terminalCommandLimit &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

export function terminalCommandProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'Use command text.';
  if (/[\r\n\p{Zl}\p{Zp}]/u.test(value)) return 'Keep the command on one line.';
  if (value.includes('\t'))
    return 'Remove tabs from the command: a typed tab triggers shell completion.';
  if (/\p{Cc}/u.test(value)) return 'Remove control characters from the command.';
  if (/\p{Cf}/u.test(value)) return 'Remove invisible formatting characters from the command.';
  if (/\p{Cs}/u.test(value)) return 'Remove unpaired Unicode surrogates from the command.';
  return undefined;
}
