import path from 'node:path';

/**
 * A PACKAGED VIEWER TAKES NO DEVTOOLS-PROTOCOL SWITCH ON THE PERSON'S OWN PROFILE. With
 * `--remote-debugging-port` or `--remote-debugging-pipe`, whatever launched Viewer had its renderer,
 * and with it every Viewer API on that profile: folder bookmarks, agent tokens, credentials and
 * approvals. The packaged test runs pass them with a profile of their own (`VIEWER_DATA_DIRECTORY`),
 * which is allowed: it holds none of those. macOS privacy grants are the app's, whatever the profile;
 * only a test-only build would keep those out of reach too.
 */
export function debuggingAllowed(options: {
  packaged: boolean;
  argv: readonly string[];
  /** `VIEWER_DATA_DIRECTORY`, resolved. */
  dataDirectory?: string;
  /** The profile Viewer uses without it, resolved. */
  defaultUserData: string;
}): boolean {
  if (
    !options.packaged ||
    !options.argv.some((argument) => /^--remote-debugging-(port|pipe)(=|$)/.test(argument))
  )
    return true;
  return (
    !!options.dataDirectory &&
    path.resolve(options.dataDirectory) !== path.resolve(options.defaultUserData)
  );
}
