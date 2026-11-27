export const resourceStatusMessages = {
  403: 'Viewer needs permission to read this file.',
  404: 'The file has moved or is no longer available.',
  413: 'The file is too large for this preview.',
  429: 'Too many preview requests. Close some previews and try again.',
} as const;

/** The resource protocol supplies a status even when a worker cannot read a response body. */
export function resourceStatusMessage(status: number): string | undefined {
  return Object.hasOwn(resourceStatusMessages, status)
    ? resourceStatusMessages[status as keyof typeof resourceStatusMessages]
    : undefined;
}
