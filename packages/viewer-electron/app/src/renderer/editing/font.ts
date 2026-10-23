import type { CSSProperties } from 'react';
import type { ApplicationSettings } from '../../domain/services';

/** The font settings as the host's CSS variables, shared with the read view (`.code-scroll`): text reads and edits in the same font. */
export const editorFont = (settings: ApplicationSettings['editor']) =>
  ({
    '--editor-font-size': `${settings.fontSize}px`,
    '--editor-line-height': `${settings.lineHeight}px`,
    // a family name only (the settings schema allows no quotes), quoted for names with spaces
    '--editor-font': `"${settings.fontFamily}"`,
    '--editor-tab-size': String(settings.tabSize),
  }) as CSSProperties;
