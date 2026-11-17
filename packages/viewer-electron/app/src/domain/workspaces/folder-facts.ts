export const folderFactsLimits = {
  bytes: 256 * 1024,
  entries: 2000,
  gitBytes: 4096,
  timeout: 150,
  quarantine: 30_000,
  relaunches: 3,
  stuckThreads: 2,
} as const;

export const folderMarkerNames = [
  '.git',
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'rush.json',
  'go.work',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'deno.json',
  'deno.jsonc',
  'Package.swift',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'mix.exs',
  'Makefile',
  'makefile',
  'GNUmakefile',
  'justfile',
  'Justfile',
  '.justfile',
  'Procfile',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
] as const;

export type FolderFactsReason =
  | 'missing'
  | 'unavailable'
  | 'not-regular'
  | 'outside-folder'
  | 'too-large'
  | 'changed'
  | 'scope'
  | 'timeout'
  | 'quarantined'
  | 'budget'
  | 'busy'
  | 'closed';

export interface FolderFactsFailure {
  ok: false;
  reason: FolderFactsReason;
}

export type FolderRead = { ok: true; path: string; bytes: Uint8Array } | FolderFactsFailure;
export const folderGitMarkers = ['directory', 'worktree', 'submodule', 'file'] as const;
export type FolderGitMarker = (typeof folderGitMarkers)[number];

export interface FolderProbe {
  ok: true;
  path: string;
  identity: { dev: bigint; ino: bigint };
  markers: string[];
  capped: boolean;
  git?: FolderGitMarker;
  package?: { name?: string; workspaces?: boolean; packageManager?: string };
}

export type FolderProbeResult = FolderProbe | FolderFactsFailure;
export type FolderFactsRequest =
  | { id: number; kind: 'read'; path: string; maxBytes: number }
  | { id: number; kind: 'probe'; path: string; identityOnly?: true };
export type FolderFactsMessage =
  FolderFactsRequest | { id: number; kind: 'allow'; allowed: boolean; files?: string[] };
export type FolderFactsReply =
  | { id: number; check: string; files?: string[] }
  | { id: number; value: FolderRead | FolderProbeResult; files?: string[] };
