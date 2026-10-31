/**
 * THE PALETTE'S MODES, one list for the palette, App and every command that opens
 * it: commands (⌘K), files (⌘F), workspaces, and the modes a first character chooses.
 */
export type PaletteMode =
  'commands' | 'files' | 'workspaces' | 'settings' | 'line' | 'prompt' | 'shell';
/** The first characters that choose a mode, in the commands palette. */
export const palettePrefixes = {
  /** Settings alone, as ⌘, opens Settings. */
  settings: ',',
  /** The command line, as in vim. */
  line: ':',
  /** A request in words, as editors' palettes start their commands. */
  prompt: '>',
  /** A shell command entered by the person. */
  shell: '!',
} as const satisfies Partial<Record<PaletteMode, string>>;
