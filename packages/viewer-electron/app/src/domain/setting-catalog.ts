import { listColumns } from './list-columns';
import { textLanguages } from './text-languages';

export interface SettingDefinition {
  path: string;
  category: string;
  label: string;
  detail?: string;
  section?: string;
  /** `color`: a `#rrggbb` colour, or empty for the automatic one. */
  kind: 'boolean' | 'choice' | 'number' | 'color';
  choices?: [string, string][];
  min?: number;
  max?: number;
}
/**
 * What the workspace window changes itself (2026-10-23): its view and presentation. Programs, Trash
 * confirmation, agents, providers, opening rules and limits change only in Settings, which a page
 * the workspace shows cannot reach. One list for the settings service and the setting commands.
 */
export const workspaceSettingPaths: readonly (readonly string[])[] = [
  ['ui'],
  ['settings', 'folders'],
  ['settings', 'appearance'],
  ['settings', 'browsing'],
  ['settings', 'savedSearches'],
  ['settings', 'editor'],
  ['settings', 'terminalFont'],
];
/** Within those, the person's own safeguards: Trash confirmation changes only in Settings. */
export const settingsOnlyPaths: readonly (readonly string[])[] = [
  ['settings', 'browsing', 'confirmTrash'],
];
const within = (paths: readonly (readonly string[])[], keys: readonly string[]) =>
  paths.some((prefix) => prefix.every((key, index) => keys[index] === key));
export const workspaceMayChange = (keys: readonly string[]) =>
  within(workspaceSettingPaths, keys) && !within(settingsOnlyPaths, keys);
/** What a setting's label needs, away from its Settings page: its section, or its category's name
 * where labels repeat across categories (Editor and Terminals both have a Font). */
export const settingContext = (definition: SettingDefinition): string | undefined =>
  definition.section ??
  (['Editor', 'Terminals', 'Previews', 'Search'].includes(definition.category)
    ? definition.category
    : undefined);
export const categories = [
  'Browsing',
  'Navigation',
  'Previews',
  'Editor',
  'Space',
  'Search',
  'Permissions',
  'Actions',
  'Models',
  'Agents',
  'Shortcuts',
  'Terminals',
  'Configuration',
  'Privacy',
];
export const settingCatalog: SettingDefinition[] = [
  {
    path: 'settings.terminals.scrollback',
    category: 'Terminals',
    label: 'Terminal scrollback lines',
    kind: 'number',
    min: 100,
    max: 50000,
  },
  {
    path: 'settings.browsing.columnWidth',
    category: 'Browsing',
    label: 'Default browsing column width',
    kind: 'number',
    min: 160,
    max: 1600,
  },
  {
    path: 'settings.fileOpening.default',
    category: 'Previews',
    label: 'Open files in',
    detail:
      'Automatic previews supported formats in planes, including Word and Excel documents in new settings. File type overrides can be edited in config.jsonc.',
    kind: 'choice',
    choices: [
      ['automatic', 'Automatic'],
      ['plane', 'Linked plane'],
      ['native', 'Native app'],
    ],
  },
  {
    path: 'settings.appearance',
    category: 'Browsing',
    label: 'Appearance',
    kind: 'choice',
    choices: [
      ['system', 'System'],
      ['dark', 'Dark'],
      ['light', 'Light'],
    ],
  },
  {
    path: 'settings.browsing.mode',
    category: 'Browsing',
    label: 'Default folder view',
    kind: 'choice',
    choices: [
      ['list', 'List'],
      ['grid', 'Grid'],
      ['columns', 'Columns'],
      ['gallery', 'Gallery'],
    ],
  },
  {
    path: 'settings.browsing.newPlaneLocation',
    category: 'Browsing',
    label: 'New folder planes start in',
    detail: 'Used by the workspace + button and ⌘N when planes are already open.',
    kind: 'choice',
    choices: [
      ['current', 'Current folder'],
      ['home', 'Home'],
      ['desktop', 'Desktop'],
      ['documents', 'Documents'],
      ['downloads', 'Downloads'],
      ['pictures', 'Pictures'],
      ['movies', 'Movies'],
      ['music', 'Music'],
      ['custom', 'Choose folder…'],
    ],
  },
  {
    path: 'settings.browsing.emptyWorkspaceLocation',
    category: 'Browsing',
    label: 'First plane in an empty workspace starts in',
    detail: 'Used by New folder plane when no planes are open, including + and ⌘N.',
    kind: 'choice',
    choices: [
      ['home', 'Home'],
      ['desktop', 'Desktop'],
      ['documents', 'Documents'],
      ['downloads', 'Downloads'],
      ['pictures', 'Pictures'],
      ['movies', 'Movies'],
      ['music', 'Music'],
      ['custom', 'Choose folder…'],
    ],
  },
  {
    path: 'settings.browsing.newFileExtension',
    category: 'Browsing',
    label: 'New text files are',
    detail: 'The extension New file… starts with, and the language a new scratch plane starts in.',
    kind: 'choice',
    // Markdown and plain text first, then each language of the highlighting table
    choices: [
      ...['markdown', 'plaintext'].flatMap((id) =>
        textLanguages.filter((language) => language.id === id),
      ),
      ...textLanguages.filter((language) => !['markdown', 'plaintext'].includes(language.id)),
    ].map((language): [string, string] => [
      language.extensions[0]!,
      `${language.label} (.${language.extensions[0]})`,
    ]),
  },
  {
    path: 'settings.browsing.density',
    category: 'Browsing',
    label: 'Row spacing',
    kind: 'choice',
    choices: [
      ['comfortable', 'Comfortable'],
      ['compact', 'Compact'],
    ],
  },
  {
    path: 'settings.browsing.foldersFirst',
    category: 'Browsing',
    label: 'Sort folders first',
    kind: 'boolean',
  },
  {
    path: 'settings.browsing.showHidden',
    category: 'Browsing',
    label: 'Show hidden files in new planes',
    kind: 'boolean',
  },
  {
    path: 'settings.browsing.restoreSession',
    category: 'Browsing',
    label: 'Restore the previous workspace',
    kind: 'boolean',
  },
  {
    path: 'settings.browsing.confirmTrash',
    category: 'Browsing',
    label: 'Confirm before moving to Trash',
    detail: 'When off, files go straight to the system Trash. Undo remains available.',
    kind: 'boolean',
  },
  ...listColumns
    .filter((column) => column.id !== 'name')
    .map((column) => ({
      path: 'ui.list.visible.' + column.id,
      category: 'Browsing',
      section: 'List columns',
      label: column.label,
      kind: 'boolean' as const,
    })),
  {
    path: 'ui.list.wrapNames',
    category: 'Browsing',
    section: 'List columns',
    label: 'Wrap long filenames',
    detail: 'Column edges can be dragged to resize. Double-click an edge to reset its width.',
    kind: 'boolean',
  },
  {
    path: 'ui.sidebar.visible',
    category: 'Navigation',
    label: 'Show window navigation',
    kind: 'boolean',
  },
  {
    path: 'ui.sidebar.inNewPlanes',
    category: 'Navigation',
    label: 'Show navigation in new folder planes',
    kind: 'boolean',
  },
  {
    path: 'settings.previews.thumbnailSize',
    category: 'Previews',
    label: 'Thumbnail size',
    kind: 'choice',
    choices: [
      ['128', '128 px'],
      ['256', '256 px'],
      ['384', '384 px'],
      ['512', '512 px'],
    ],
  },
  {
    path: 'settings.previews.maxImagePixels',
    category: 'Previews',
    label: 'Image pixel limit',
    detail: 'Larger images offer a bounded thumbnail and Open in default app.',
    kind: 'number',
    min: 1000000,
    max: 128000000,
  },
  {
    path: 'settings.previews.maxModelMB',
    category: 'Previews',
    label: '3D file limit (MB)',
    kind: 'number',
    min: 16,
    max: 512,
  },
  {
    path: 'settings.terminalFont.fontFamily',
    category: 'Terminals',
    label: 'Font',
    detail: 'Menlo is used where this font is not installed.',
    kind: 'choice',
    choices: [
      ['Hack Nerd Font Mono', 'Hack Nerd Font Mono'],
      ['MesloLGS NF', 'MesloLGS NF'],
      ['Menlo', 'Menlo'],
      ['SF Mono', 'SF Mono'],
      ['Monaco', 'Monaco'],
      ['JetBrains Mono', 'JetBrains Mono'],
      ['Fira Code', 'Fira Code'],
    ],
  },
  {
    path: 'settings.terminalFont.fontSize',
    category: 'Terminals',
    label: 'Font size',
    kind: 'number',
    min: 8,
    max: 48,
  },
  {
    path: 'settings.terminalFont.fontWeight',
    category: 'Terminals',
    label: 'Font weight',
    kind: 'choice',
    choices: [
      ['normal', 'Regular'],
      ['bold', 'Bold'],
    ],
  },
  {
    path: 'settings.terminalFont.lineHeight',
    category: 'Terminals',
    label: 'Line spacing',
    kind: 'choice',
    choices: [
      ['1', '1.0'],
      ['1.1', '1.1'],
      ['1.2', '1.2'],
      ['1.3', '1.3'],
      ['1.4', '1.4'],
      ['1.5', '1.5'],
      ['1.75', '1.75'],
      ['2', '2.0'],
    ],
  },
  {
    path: 'settings.terminalFont.letterSpacing',
    category: 'Terminals',
    label: 'Letter spacing',
    detail: 'Pixels between characters.',
    kind: 'number',
    min: 0,
    max: 8,
  },
  {
    path: 'settings.editor.fontSize',
    category: 'Editor',
    label: 'Font size',
    kind: 'number',
    min: 8,
    max: 48,
  },
  {
    path: 'settings.editor.lineHeight',
    category: 'Editor',
    label: 'Line height',
    detail: 'In pixels.',
    kind: 'number',
    min: 10,
    max: 96,
  },
  {
    path: 'settings.editor.fontFamily',
    category: 'Editor',
    label: 'Font',
    kind: 'choice',
    choices: [
      ['Menlo', 'Menlo'],
      ['SF Mono', 'SF Mono'],
      ['Monaco', 'Monaco'],
      ['Courier New', 'Courier New'],
      ['Andale Mono', 'Andale Mono'],
      ['JetBrains Mono', 'JetBrains Mono'],
      ['Fira Code', 'Fira Code'],
    ],
  },
  {
    path: 'settings.editor.tabSize',
    category: 'Editor',
    label: 'Tab size',
    kind: 'number',
    min: 1,
    max: 16,
  },
  {
    path: 'settings.editor.insertSpaces',
    category: 'Editor',
    label: 'Indent with spaces',
    kind: 'boolean',
  },
  {
    path: 'settings.editor.wordWrap',
    category: 'Editor',
    label: 'Wrap long lines',
    kind: 'boolean',
  },
  {
    path: 'settings.editor.lineNumbers',
    category: 'Editor',
    label: 'Show line numbers',
    kind: 'boolean',
  },
  {
    path: 'settings.editor.trimTrailingWhitespace',
    category: 'Editor',
    label: 'Trim trailing whitespace on save',
    kind: 'boolean',
  },
  {
    path: 'ui.space.color',
    category: 'Space',
    label: 'Space colour',
    detail:
      'The colour behind the planes; Automatic follows the appearance. A workspace can have its own: Workspace background… in the Workspace menu.',
    kind: 'color',
  },
  {
    path: 'ui.titlebar.visible',
    category: 'Space',
    label: 'Show title bar',
    detail: 'Hidden (⌥⌘T), it comes back while the pointer is at the window’s top edge.',
    kind: 'boolean',
  },
  {
    path: 'ui.space.backdrop',
    category: 'Space',
    label: 'Space background',
    detail:
      'Blur or clear lets you see what is behind Viewer’s window between planes; planes stay solid. Clear applies when the window next opens.',
    kind: 'choice',
    choices: [
      ['opaque', 'Solid'],
      ['blur', 'Blur'],
      ['clear', 'Clear'],
    ],
  },
  {
    path: 'ui.space.backdropOpacity',
    category: 'Space',
    label: 'Space background opacity (%)',
    detail: 'How much of the space’s colour covers what is behind, when it is blurred or clear.',
    kind: 'number',
    min: 0,
    max: 100,
  },
  {
    path: 'ui.space.opening',
    category: 'Space',
    label: 'When opening a plane',
    kind: 'choice',
    choices: [
      ['face-on', 'Face the plane'],
      ['pair', 'Show linked pair'],
      ['dock', 'Dock the plane'],
    ],
  },
  ...(
    [
      ['grid', 'Show background grid'],
      // plurid's toolbar along the space's bottom: rotate, scale, translate
      ['toolbar', 'Show space toolbar'],
      ['minimap', 'Show minimap'],
      ['viewcube', 'Show viewcube'],
      ['planeHeaders', 'Show plane headers'],
      ['dragging', 'Drag planes by their title'],
      ['resizing', 'Show resize handles'],
      ['origin', 'Show transform origin'],
    ] as const
  ).map(([key, label]) => ({
    path: 'ui.space.' + key,
    category: 'Space',
    label,
    kind: 'boolean' as const,
  })),
  ...(
    [
      ['parent', 'Back to parent button'],
      ['sidebar', 'Navigation button'],
      ['back', 'Back button'],
      ['forward', 'Forward button'],
      ['view', 'View menu'],
      ['search', 'Folder search'],
      ['frame', 'Frame plane button'],
      ['dock', 'Dock plane button'],
      ['actions', 'Actions menu'],
      ['close', 'Close plane button'],
    ] as const
  ).map(([key, label]) => ({
    path: 'ui.space.headerControls.' + key,
    category: 'Space',
    section: 'Plane toolbar',
    label,
    kind: 'boolean' as const,
  })),
  {
    path: 'settings.search.paused',
    category: 'Search',
    label: 'Pause background indexing',
    kind: 'boolean',
  },
];
export function settingValue(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.'))
    current =
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[key]
        : undefined;
  return current;
}
