import type { Theme } from './preferences/themes';
import { commonSearchExclusions } from './search/exclusions';
import type { Toolbars } from './preferences/toolbars';
import type { SettingProfile } from './preferences/profiles';
import type { LayoutTemplate } from './workspaces/layout-templates';
import type { TileLayout } from './workspaces/tiling';
import { defaultKeymap, type Keymap } from './preferences/keymap';
import type { SearchEvidence, EvidenceAnchor } from './files/inspection';
import type { FileEntry, UIPreferences, ViewMode, SortKey, Look } from './contracts';
import type { FolderOverride } from './preferences/folder-presentation';
import type { CustomAction, TerminalProfile } from './automation/actions';
import type { ProviderKind } from './models/providers';
import type { ChangePlan } from './operations/change-plan';
import type { OfficeContent } from './previews/documents/office';
import type { EPUBChapter, EPUBImage } from './previews/documents/epub';
import type { MailMessage } from './previews/mail/message';
import type { Mailbox } from './previews/mail/mailbox';
import type { WebArchiveSummary } from './previews/documents/web-archive';
import type { InspectedFile } from './previews/inspected';
import type { OptimizationRecipe } from './operations/optimization';
import type { FileGrouping } from './files/entries';
export type { ProviderKind } from './models/providers';
export interface ModelProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  endpoint: string;
  model: string;
  allowContent: boolean;
}
export type RecipeKind = 'batch-rename' | 'book-name' | 'rename' | 'organize' | 'summarize';
export interface ActionRecipe {
  id: string;
  name: string;
  kind: RecipeKind;
  formats: string[];
  recursive: boolean;
  instructions: string;
  template: string;
  providerID?: string;
  data: 'names' | 'excerpts' | 'full-text';
  shortcut?: string;
}
export interface ApplicationSettings {
  toolbars: Toolbars;
  checkpoints: { budgetBytes: number };
  appearance: 'system' | Look;
  browsing: {
    /** The default for folders without their own view; Map is chosen per folder. */
    mode: Exclude<ViewMode, 'map'>;
    sort: SortKey;
    descending: boolean;
    group: FileGrouping;
    columnWidth: number;
    density: 'comfortable' | 'compact';
    scrollbars: 'system' | 'always';
    foldersFirst: boolean;
    showHidden: boolean;
    restoreSession: boolean;
    confirmTrash: boolean;
    /** A Suggested section in file menus, from rules and what the person chooses. */
    suggestions: boolean;
    /** Suggestion rules turned off by id (`domain/suggestions/rules.ts`). */
    suggestionRulesOff: string[];
    /** The prompt model may add suggestions, from names, once per folder (opt-in). */
    modelSuggestions: boolean;
    /** Insight cards above a folder's files (`domain/suggestions/insights.ts`). */
    insights: boolean;
    newPlaneLocation:
      | 'current'
      | 'home'
      | 'desktop'
      | 'documents'
      | 'downloads'
      | 'pictures'
      | 'movies'
      | 'music'
      | 'custom';
    newPlanePath: string;
    emptyWorkspaceLocation: Exclude<ApplicationSettings['browsing']['newPlaneLocation'], 'current'>;
    emptyWorkspacePath: string;
    /** Default extension for New file and scratch buffers. */
    newFileExtension: string;
  };
  folders: Record<string, FolderOverride>;
  fileOpening: {
    default: 'automatic' | 'plane' | 'native';
    types: Record<string, 'plane' | 'native'>;
  };
  customActions: CustomAction[];
  terminals: {
    application: string;
    profileID: string;
    profiles: TerminalProfile[];
    scrollback: number;
    tmux: { executable: string; session: string; socket: string; windowName: string };
  };
  previews: {
    thumbnailSize: number;
    maxImagePixels: number;
    maxModelMB: number;
    textFontSize: number;
    textLineHeight: number;
    textWordWrap: boolean;
  };
  /** Editor appearance and behavior defaults. */
  editor: {
    fontSize: number;
    /** In pixels. */
    lineHeight: number;
    /** A monospace family; the system's follows it. */
    fontFamily: string;
    tabSize: number;
    insertSpaces: boolean;
    wordWrap: boolean;
    lineNumbers: boolean;
    /** On save, spaces and tabs at line ends go. */
    trimTrailingWhitespace: boolean;
  };
  /** Terminal typography, independent of preview and editor metrics. */
  terminalFont: {
    /** A monospace family; Menlo follows it. */
    fontFamily: string;
    fontSize: number;
    fontWeight: 'normal' | 'bold';
    /** A multiple of the font's height, as iTerm's vertical spacing. */
    lineHeight: number;
    /** Pixels added between characters. */
    letterSpacing: number;
  };
  /** Default tiling behavior for workspace planes. */
  tiling: {
    /** What a split adds beside the active plane: a copy of it, a folder, a terminal, a scratch plane. */
    splitWith: 'same' | 'folder' | 'terminal' | 'scratch';
    /** The layout tiling starts with. */
    defaultLayout: TileLayout;
  };
  /** Provider for requests in words; an empty ID selects the first provider. */
  prompts: { providerID: string };
  git: { enabled: boolean };
  hotkey: { enabled: boolean; shortcut: string };
  /** ⌘Q needs a second press; the menu, the Dock and logging out quit at once. */
  quit: { warnShortcut: boolean };
  /** A quiet check for a newer direct download at launch, at most once a day. */
  updates: { checkAtLaunch: boolean };
  /** Colour themes: domain/preferences/themes.ts. */
  themes: Theme[];
  /** The theme for each appearance; empty is the built-in one. */
  theme: { dark: string; light: string };
  /** Named sets of settings applied at once: domain/preferences/profiles.ts. */
  profiles: SettingProfile[];
  /** Named sets of planes and their tiling, to open anywhere: domain/workspaces/layout-templates.ts. */
  layouts: LayoutTemplate[];
  /** Tour: flying through the space's views in turn. */
  tour: {
    /** How long each view shows, ms. */
    dwell: number;
    /** How long each flight takes, ms. */
    duration: number;
    /** Whether the last view leads to the first again. */
    loop: boolean;
  };
  search: { roots: string[]; exclusions: string[]; contentRoots: string[]; paused: boolean };
  providers: ModelProvider[];
  recipes: ActionRecipe[];
  optimizationRecipes: OptimizationRecipe[];
  agents: { enabled: boolean; roots: string[]; allowLayout: boolean };
  shortcuts: Record<string, string>;
  /** The prefix and leader keys and their sequences: domain/preferences/keymap.ts. */
  keymap: Keymap;
  savedSearches: {
    id: string;
    name: string;
    query: string;
    root?: string;
    recursive?: boolean;
    content?: boolean;
  }[];
  /** No longer used: read once, as the Settings window's first size and category. */
  settingsWindow?: { width: number; height: number; category: string };
}
export interface SettingsSnapshot {
  revision: number;
  settings: ApplicationSettings;
  ui: UIPreferences;
  look: Look;
  /** The OS appearance, independent of the shared appearance preference. */
  systemLook?: Look;
  credentials: string[];
  config?: {
    path: string;
    diagnostics: string[];
    changes: string[];
    /** config.jsonc was removed while Viewer ran: the settings stay, the next change writes it back. */
    missing?: boolean;
    /** Said once, after a removed config.jsonc was restored from its last valid copy. */
    restored?: string;
    /** What is in effect while config.jsonc cannot be read. */
    fallback?: 'last-valid' | 'defaults';
    /** References to missing items (`referenceIssues`): kept, and failing when used. */
    warnings?: string[];
  };
}
export interface SettingsPatch {
  path: string;
  value: unknown;
  keys?: string[];
}
export interface IndexStatus {
  roots: {
    path: string;
    status: 'indexing' | 'ready' | 'offline' | 'paused';
    count: number;
    errors: number;
  }[];
  count: number;
  running: boolean;
}
export interface IndexedQuery {
  query: string;
  /** The paths of each Finder tag the query names, looked up before (main only). */
  tagged?: Record<string, string[]>;
  root?: string;
  offset?: number;
  limit?: number;
  showHidden?: boolean;
  content?: boolean;
  recursive?: boolean;
}
export interface IndexedResult {
  entries: FileEntry[];
  evidence?: SearchEvidence[];
  more: boolean;
  indexed: boolean;
  /** A complex query stopped before deciding every candidate; distinct from result pagination. */
  scanLimited?: boolean;
  status: IndexStatus;
}
export interface DocumentEvidence {
  source: string;
  text: string;
  anchor?: EvidenceAnchor;
}
export interface DocumentData {
  path: string;
  metadata: Record<string, string>;
  evidence: DocumentEvidence[];
  text: string;
  chapters?: EPUBChapter[];
  epub?: { images: EPUBImage[] };
  office?: OfficeContent;
  /** An email message, or one message of a mailbox. */
  mail?: MailMessage;
  /** A mailbox's list of messages. */
  mailbox?: Mailbox;
  /** A saved web page's address; its page is served on its own. */
  webArchive?: WebArchiveSummary;
  /** A certificate or key file, a torrent or a provisioning profile, field by field. */
  inspected?: InspectedFile;
  coverageReason?: string;
  truncated: boolean;
}
/** Who asked: the person, or an agent acting through Viewer's tools. */
export const requestActors = ['user', 'agent'] as const;
export type RequestActor = (typeof requestActors)[number];
export interface ActionContext {
  workspaceID: string;
  rootID: string;
  paneID: string;
  sources: string[];
  actor: RequestActor;
  clientID?: string;
  recursive?: boolean;
}
export interface ActionRequest {
  recipeID: string;
  context: ActionContext;
  instructions?: string;
  options?: {
    template?: string;
    prefix?: string;
    suffix?: string;
    find?: string;
    replace?: string;
    start?: number;
    padding?: number;
    case?: 'keep' | 'lower' | 'upper' | 'title';
    regex?: boolean;
    ignoreCase?: boolean;
    metadata?: boolean;
  };
}
export interface ProposedChange {
  id: string;
  source?: FileEntry;
  kind: 'rename' | 'move' | 'mkdir' | 'summary';
  destination: string;
  text?: string;
  evidence: DocumentEvidence[];
  issue?: string;
  approved: boolean;
  completed?: boolean;
  stagedPath?: string;
  /** Canonical source scope captured before moving; retained for guarded restoration. */
  scopeRoot?: string;
  restoration?: { destination: string; root: string };
  error?: string;
}
export interface ActionPlan extends ChangePlan<ProposedChange> {
  recipeID: string;
  context: ActionContext;
  outputRoot?: string;
  summary?: string;
  summaryInputs?: FileEntry[];
  error?: string;
}
export interface ActionApproval {
  id: string;
  revision: number;
  checkpoint?: boolean;
  rows: { id: string; destination: string; approved: boolean }[];
}
/** Whether a recipe reads document contents. Book naming always extracts local
 * publication metadata and text, whatever data level it sends to a model. */
export function recipeReadsContent(recipe: Pick<ActionRecipe, 'kind' | 'data'>): boolean {
  return recipe.data !== 'names' || recipe.kind === 'book-name';
}
export const builtInRecipes: ActionRecipe[] = [
  {
    id: 'batch-rename',
    name: 'Batch rename',
    kind: 'batch-rename',
    formats: [],
    recursive: false,
    instructions: '',
    template: '{name}{extension}',
    data: 'names',
  },
  {
    id: 'book-name',
    name: 'Rename as book',
    kind: 'book-name',
    formats: ['pdf', 'epub'],
    recursive: true,
    instructions:
      'Use the actual publication edition. Author names use given-name initials and surname. Preserve proper nouns in the title. Cite the publication text for each field. Leave unknown or conflicting fields unresolved.',
    template: '{year}, {authors}, {title}, {publisher}{extension}',
    data: 'excerpts',
  },
  {
    id: 'rename',
    name: 'Rename with instructions',
    kind: 'rename',
    formats: [],
    recursive: false,
    instructions: 'Suggest descriptive names while preserving extensions.',
    template: '',
    data: 'excerpts',
  },
  {
    id: 'organize',
    name: 'Organize files',
    kind: 'organize',
    formats: [],
    recursive: false,
    instructions:
      'Group files into meaningful folders within their existing parent directory. Do not discard or overwrite any file.',
    template: '',
    data: 'names',
  },
  {
    id: 'summarize',
    name: 'Summarize',
    kind: 'summarize',
    formats: [],
    recursive: true,
    instructions:
      'Summarize the selected documents, identify their sources, and distinguish uncertainty from facts.',
    template: '',
    data: 'full-text',
  },
];
export function defaultSettings(home: string): ApplicationSettings {
  return {
    toolbars: {},
    checkpoints: { budgetBytes: 5_000_000_000 },
    appearance: 'system',
    browsing: {
      mode: 'list',
      sort: 'name',
      descending: false,
      group: 'none',
      columnWidth: 280,
      density: 'comfortable',
      scrollbars: 'system',
      foldersFirst: true,
      showHidden: false,
      restoreSession: true,
      confirmTrash: true,
      suggestions: true,
      suggestionRulesOff: [],
      modelSuggestions: false,
      insights: true,
      newPlaneLocation: 'current',
      newPlanePath: '',
      emptyWorkspaceLocation: 'home',
      emptyWorkspacePath: '',
      newFileExtension: 'md',
    },
    folders: {},
    fileOpening: {
      default: 'automatic',
      types: {
        doc: 'plane',
        docx: 'plane',
        xls: 'plane',
        xlsx: 'plane',
        ppt: 'plane',
        pptx: 'plane',
      },
    },
    customActions: [],
    terminals: {
      application: 'auto',
      profileID: 'login',
      profiles: [{ id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} }],
      scrollback: 10000,
      tmux: { executable: 'tmux', session: 'viewer', socket: '', windowName: '{folder}' },
    },
    previews: {
      thumbnailSize: 256,
      maxImagePixels: 64000000,
      maxModelMB: 256,
      textFontSize: 16,
      textLineHeight: 20,
      textWordWrap: false,
    },
    editor: {
      fontSize: 18,
      lineHeight: 40,
      fontFamily: 'Menlo',
      tabSize: 4,
      insertSpaces: true,
      wordWrap: false,
      lineNumbers: true,
      trimTrailingWhitespace: true,
    },
    terminalFont: {
      fontFamily: 'Hack Nerd Font Mono',
      fontSize: 17,
      fontWeight: 'bold',
      lineHeight: 1.3,
      letterSpacing: 1,
    },
    tiling: { splitWith: 'same', defaultLayout: 'even-horizontal' },
    layouts: [],
    profiles: [],
    themes: [],
    prompts: { providerID: '' },
    git: { enabled: false },
    hotkey: { enabled: false, shortcut: 'Alt+Space' },
    quit: { warnShortcut: true },
    updates: { checkAtLaunch: true },
    theme: { dark: '', light: '' },
    tour: { dwell: 3000, duration: 900, loop: true },
    search: {
      roots: [home],
      exclusions: [home + '/Library', ...commonSearchExclusions],
      contentRoots: [],
      paused: false,
    },
    providers: [],
    recipes: builtInRecipes.map((recipe) => ({ ...recipe })),
    optimizationRecipes: [],
    agents: { enabled: false, roots: [], allowLayout: false },
    shortcuts: {},
    keymap: structuredClone(defaultKeymap) as Keymap,
    savedSearches: [],
  };
}
export function newPlaneFolder(
  browsing: ApplicationSettings['browsing'],
  home: string,
  currentFolder?: string,
  emptyWorkspace = false,
): string {
  const location = emptyWorkspace ? browsing.emptyWorkspaceLocation : browsing.newPlaneLocation;
  const customPath = emptyWorkspace ? browsing.emptyWorkspacePath : browsing.newPlanePath;
  if (location === 'current') return currentFolder || home;
  if (location === 'home') return home;
  if (location === 'custom') return customPath || home;
  const name = location;
  const separator = home.includes('\\') ? '\\' : '/';
  return home.replace(/[\\/]$/, '') + separator + name.charAt(0).toUpperCase() + name.slice(1);
}
