import type { FileEntry, UIPreferences, ViewMode } from './contracts';
export type ProviderKind = 'openai' | 'anthropic' | 'local';
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
  appearance: 'system' | 'dark' | 'light';
  browsing: {
    mode: ViewMode;
    density: 'comfortable' | 'compact';
    foldersFirst: boolean;
    showHidden: boolean;
    restoreSession: boolean;
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
}
export interface SettingsPatch {
  path: string;
  value: unknown;
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
  more: boolean;
  indexed: boolean;
  status: IndexStatus;
}
export interface DocumentEvidence {
  source: string;
  text: string;
}
export interface DocumentData {
  path: string;
  metadata: Record<string, string>;
  evidence: DocumentEvidence[];
  text: string;
  chapters?: { title: string; html: string }[];
  truncated: boolean;
}
export interface ActionContext {
  workspaceID: string;
  rootID: string;
  paneID: string;
  sources: string[];
  actor: 'user' | 'agent';
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
export interface ActionPlan {
  id: string;
  revision: number;
  recipeID: string;
  title: string;
  context: ActionContext;
  status:
    | 'planning'
    | 'review'
    | 'applying'
    | 'completed'
    | 'partial'
    | 'cancelled'
    | 'failed'
    | 'recovery';
  rows: ProposedChange[];
  outputRoot?: string;
  summary?: string;
  summaryInputs?: FileEntry[];
  error?: string;
  undoable: boolean;
}
export interface ActionApproval {
  id: string;
  revision: number;
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
    appearance: 'system',
    browsing: {
      mode: 'list',
      density: 'comfortable',
      foldersFirst: true,
      showHidden: false,
      restoreSession: true,
      newPlaneLocation: 'current',
      newPlanePath: '',
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
): string {
  if (browsing.newPlaneLocation === 'current') return currentFolder || home;
  if (browsing.newPlaneLocation === 'home') return home;
  if (browsing.newPlaneLocation === 'custom') return browsing.newPlanePath || home;
  const name = browsing.newPlaneLocation;
  const separator = home.includes('\\') ? '\\' : '/';
  return home.replace(/[\\/]$/, '') + separator + name[0].toUpperCase() + name.slice(1);
}
