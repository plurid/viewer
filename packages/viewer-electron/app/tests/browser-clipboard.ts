/** Clipboard adapter for the browser verification shell. Desktop uses Electron. */
export async function copyBrowserPaths(
  paths: string[],
  complete: () => Promise<void>,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
): Promise<void> {
  if (!clipboard?.writeText)
    throw new Error(
      'This browser cannot access the clipboard. Open the preview on localhost or HTTPS.',
    );
  if (!paths.length) throw new Error('Choose a file or folder path to copy.');
  try {
    await clipboard.writeText(paths.join('\n'));
  } catch (cause) {
    throw new Error(
      'Copy Path needs clipboard permission. Allow clipboard access for this page, then try again.',
      { cause },
    );
  }
  await complete();
}
