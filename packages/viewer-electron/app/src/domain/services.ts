import type { SearchEvidence, EvidenceAnchor } from './inspection';
import type { FileEntry, UIPreferences, ViewMode, SortKey } from './contracts';
import type { FolderOverride } from './folder-presentation';
import type { CustomAction, TerminalProfile } from './automation';
import type { ProviderKind } from './model-providers';
import type { ChangePlan } from './change-plan';
import type { OfficeContent } from './office';
export type { ProviderKind } from './model-providers';
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
  checkpoints: { budgetBytes: number };
  appearance: 'system' | 'dark' | 'light';
  browsing: {
    /** The default for folders without their own view; Map is chosen per folder. */
    mode: Exclude<ViewMode, 'map'>;
    sort: SortKey;
    descending: boolean;
    group: 'none' | 'kind' | 'modified';
    columnWidth: number;
    density: 'comfortable' | 'compact';
    foldersFirst: boolean;
    showHidden: boolean;
    restoreSession: boolean;
    confirmTrash: boolean;
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
  previews: { thumbnailSize: number; maxImagePixels: number; maxModelMB: number };
  search: { roots: string[]; exclusions: string[]; contentRoots: string[]; paused: boolean };
  providers: ModelProvider[];
  recipes: ActionRecipe[];
  agents: { enabled: boolean; roots: string[]; allowLayout: boolean };
  shortcuts: Record<string, string>;
  savedSearches: {
    id: string;
    name: string;
    query: string;
    root?: string;
    recursive?: boolean;
    content?: boolean;
  }[];
  settingsWindow: { width: number; height: number; category: string };
}
export interface SettingsSnapshot {
  revision: number;
  settings: ApplicationSettings;
  ui: UIPreferences;
  look: 'dark' | 'light';
  credentials: string[];
  config?: { path: string; diagnostics: string[]; changes: string[] };
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
  chapters?: { title: string; html: string }[];
  office?: OfficeContent;
  coverageReason?: string;
  truncated: boolean;
}
export interface ActionContext {
  workspaceID: string;
  rootID: string;
  paneID: string;
  sources: string[];
  actor: 'user' | 'agent';
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
    checkpoints: { budgetBytes: 5 * 1024 ** 3 },
    appearance: 'system',
    browsing: {
      mode: 'list',
      sort: 'name',
      descending: false,
      group: 'none',
      columnWidth: 280,
      density: 'comfortable',
      foldersFirst: true,
      showHidden: false,
      restoreSession: true,
      confirmTrash: true,
      newPlaneLocation: 'current',
      newPlanePath: '',
      emptyWorkspaceLocation: 'home',
      emptyWorkspacePath: '',
    },
    folders: {},
    fileOpening: {
      default: 'automatic',
      types: {
        doc: 'native',
        docx: 'plane',
        xls: 'native',
        xlsx: 'plane',
        ppt: 'native',
        pptx: 'native',
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
    previews: { thumbnailSize: 256, maxImagePixels: 64000000, maxModelMB: 256 },
    search: {
      roots: [home],
      exclusions: [home + '/Library', '.git', 'node_modules', '.cache', '.vite', 'out'],
      contentRoots: [],
      paused: false,
    },
    providers: [],
    recipes: builtInRecipes.map((recipe) => ({ ...recipe })),
    agents: { enabled: false, roots: [], allowLayout: false },
    shortcuts: {},
    savedSearches: [],
    settingsWindow: { width: 900, height: 640, category: 'browsing' },
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
