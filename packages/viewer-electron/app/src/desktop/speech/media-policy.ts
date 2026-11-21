/** Microphone capture belongs to an explicit session in the trusted top-level app frame. */
export function speechMediaAllowed(input: {
  permission: string;
  mainFrame: boolean;
  trusted: boolean;
  active: boolean;
  media: readonly string[];
}): boolean {
  return (
    input.permission === 'media' &&
    input.mainFrame &&
    input.trusted &&
    input.active &&
    input.media.length === 1 &&
    input.media[0] === 'audio'
  );
}

/** Device enumeration in Settings may read microphone names once OS microphone access is granted,
 * while capture requests still require an active session through `speechMediaAllowed`. */
export function speechMediaCheckAllowed(input: {
  permission: string;
  mainFrame: boolean;
  trusted: boolean;
  active: boolean;
  settingsEnumeration: boolean;
  media: readonly string[];
}): boolean {
  return speechMediaAllowed({
    ...input,
    active: input.active || input.settingsEnumeration,
  });
}
