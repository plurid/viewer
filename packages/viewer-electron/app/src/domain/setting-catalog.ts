import { listColumns } from './list-columns';

export interface SettingDefinition {
  path: string;
  category: string;
  label: string;
  detail?: string;
  section?: string;
  kind: 'boolean' | 'choice' | 'number';
  choices?: [string, string][];
  min?: number;
  max?: number;
}
export const categories = [
  'Browsing',
  'Navigation',
  'Previews',
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
      'Automatic previews supported formats in planes. Office documents open in their native app. File type overrides can be edited in config.jsonc.',
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
      ['toolbar', 'Show bottom toolbar'],
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
  {
    path: 'settings.agents.enabled',
    category: 'Agents',
    label: 'Allow local agent clients',
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
