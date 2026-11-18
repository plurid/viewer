/** The shapes a review run shares between its scenes, the runner, the checks and the report. */
import type { Look, ViewMode } from '../../src/domain/contracts';
import type { ReviewPage } from './page';

export type { Look };

/** The automatic checks, each recorded per capture (checks.ts explains what each one catches). */
export type CheckID =
  | 'wrap'
  | 'clipped'
  | 'window-overflow'
  | 'scroll-overflow'
  | 'dialog-scroll'
  | 'menu-covers-trigger'
  | 'menu-search'
  | 'home-path'
  | 'em-dash'
  | 'broken-value'
  | 'plural'
  | 'name-extension'
  | 'layout-shift'
  | 'measure'
  | 'wording';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One problem a check found in one capture. */
export interface Finding {
  check: CheckID;
  /** A CSS path that finds the element again in the same state. */
  selector: string;
  /** The element's visible text, shortened. */
  text: string;
  /** What is wrong, in a sentence. */
  detail: string;
  /** Where the element is, in CSS pixels of the capture. */
  box?: Box;
  /** Why this is a known false alarm, when the allowlist names it. */
  allowed?: string;
}

/** A window size and appearance a scene is captured in. */
export interface Variant {
  id: string;
  label: string;
  width: number;
  height: number;
  look: Look;
  /** Scene-specific choices, such as `name: 'long'`, that the steps read. */
  data: Readonly<Record<string, string>>;
}

/** Which window a scene's capture shows. */
export type ReviewWindow = 'main' | 'settings';

/** The state a scene's profile starts in: written to disk before the app starts. */
export interface SceneSetup {
  /** The folder the plane shows, relative to the sample home. */
  folder: string;
  view?: ViewMode;
  /** Whether the plane's sidebar shows. */
  sidebar?: boolean;
  /** Whether the Recent section of the sidebar starts folded. */
  recentFolded?: boolean;
  /** Folders listed under Recent, relative to the sample home. */
  recents?: readonly string[];
  /** Whether Viewer's title bar shows. */
  titlebar?: boolean;
  /** A second workspace for the switcher and Manage, with this name. */
  otherWorkspace?: string;
  /** This many more workspaces, for long switcher lists. */
  extraWorkspaces?: number;
  /** A project for the workspace: its folder and its outside folders by binding name, relative
   * to the sample home. */
  project?: { root: string; bindings: Readonly<Record<string, string>> };
}

/** What a scene shows, for the coverage list: ids as coverage.ts lists them. */
export interface SceneCoverage {
  commands?: readonly string[];
  dialogs?: readonly string[];
  settings?: readonly string[];
  previews?: readonly string[];
}

/** One reviewable state of the app. */
export interface Scene {
  /** Unique across the catalog: lowercase words joined by hyphens. */
  id: string;
  title: string;
  /** What a person must see, in plain words. */
  mustBeTrue: readonly string[];
  setup: SceneSetup;
  /** Drives the started app to the state the capture shows. */
  steps(page: ReviewPage, variant: Variant): Promise<void>;
  /** The variants to capture; the four standard ones when absent. */
  variants?: readonly Variant[];
  covers?: SceneCoverage;
  /** File name cells whose text must keep the extension, beyond the shared ones. */
  nameCells?: readonly string[];
  /** The scene's subject, such as `dialog[open]`: findings elsewhere in the window, which other
   * scenes show, are left out. checks.ts `planeInView` stands for the plane in view. */
  focus?: readonly string[];
  /** Why the scene cannot be captured yet: it is listed, not run. */
  blocked?: string;
  /** What the scene needs from the app, checked before its steps: a build without it reports
   * "needs a newer build" instead of a failure. */
  requires?: readonly Requirement[];
}

/** A feature a scene needs: a palette command by its label, an element, or the QA runtime's
 * hooks (Trash and places in the sample home, the command list, the markers). */
export type Requirement =
  | { command: string }
  | { selector: string; what: string }
  | { text: string; what: string }
  | { qaHooks: true };

/** A module of scenes for one part of the app. */
export interface ReviewArea {
  id: string;
  title: string;
  scenes: readonly Scene[];
}

/** One variant's outcome. */
export interface Capture {
  variant: Variant;
  /** The PNG, relative to the run folder; absent when the steps failed before it. */
  image?: string;
  /** The window's CSS size when captured. */
  viewport?: { width: number; height: number };
  findings: Finding[];
  /** Why the steps failed, when they did. */
  error?: string;
  /** What the build lacks, when the scene needs a newer one. */
  newerBuild?: string;
  /** Milliseconds from launch to the closed app. */
  milliseconds: number;
  /** Command palette labels the steps ran. */
  commands: string[];
  /** The accessible names of the dialogs open when captured. */
  dialogs: string[];
  /** Against the accepted baseline, when one exists. */
  baseline?: BaselineComparison;
}

export interface BaselineComparison {
  /** The accepted capture copied beside this one, relative to the run folder. */
  image?: string;
  /** A picture of the changed pixels, relative to the run folder. */
  difference?: string;
  /** The share of pixels that changed, 0 to 1; absent when the sizes differ. */
  changed?: number;
  sameSize: boolean;
  acceptedRun: string;
}

export interface SceneResult {
  id: string;
  area: string;
  title: string;
  mustBeTrue: readonly string[];
  captures: Capture[];
  covers: SceneCoverage;
  /** Why the scene was not captured. */
  blocked?: string;
  /** What the build lacks, when no variant could be captured. */
  newerBuild?: string;
}

/** One entry of a coverage list. */
export interface CoverageEntry {
  id: string;
  label: string;
  /** The scenes that show it. */
  scenes: string[];
}

export interface Coverage {
  commands: CoverageEntry[];
  dialogs: CoverageEntry[];
  settings: CoverageEntry[];
  previews: CoverageEntry[];
}

export interface RunResults {
  version: 1;
  run: string;
  /** The packaged app, relative to the repository, or from ~. */
  binary: string;
  /** How many app instances ran at once. */
  parallel: number;
  /** Where the command list came from: the app's own list, or a scan of the source. */
  commandSource: 'runtime' | 'source';
  started: string;
  milliseconds: number;
  /** The run's generated samples and profiles, kept for the owner to move to the Trash. */
  samples: string;
  areas: { id: string; title: string }[];
  scenes: SceneResult[];
  coverage: Coverage;
  /** Why the run stopped early, when it did. */
  stopped?: string;
}
