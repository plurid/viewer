/** Microphone permission belongs to an explicit session in the trusted top-level app frame. */
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
