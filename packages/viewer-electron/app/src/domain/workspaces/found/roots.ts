import type { FolderProbe } from '../folder-facts';
import { remembersFolder } from '../../files/folder-visits';
import { commonSearchExclusions } from '../../search/exclusions';

export const insideRoot = (root: string, folder: string): boolean =>
  folder === root || folder.startsWith(root === '/' ? '/' : root + '/');
export const parentFolder = (folder: string): string =>
  folder.slice(0, folder.lastIndexOf('/')) || '/';

export function foundVolumeRoots(mounts?: readonly { path: string; local: boolean }[]) {
  return {
    localVolumes:
      mounts
        ?.filter((mount) => mount.local && /^\/Volumes\/[^/]+$/.test(mount.path))
        .map((mount) => mount.path) ?? [],
    nonLocalRoots: mounts?.length
      ? mounts.filter((mount) => !mount.local).map((mount) => mount.path)
      : ['/'],
  };
}

export interface FoundRootContext {
  home: string;
  localVolumes?: readonly string[];
  nonLocalRoots?: readonly string[];
  scopeRoot?: string;
  hidden?: readonly string[];
}
type RootProbe = Pick<FolderProbe, 'markers' | 'git' | 'package'>;
const homeFolders = new Set([
  'desktop',
  'documents',
  'downloads',
  'library',
  'movies',
  'music',
  'pictures',
  'public',
]);
const buildOutputs = new Set(['target', 'out']);
const excluded = new Set<string>(commonSearchExclusions.filter((part) => !buildOutputs.has(part)));
const workspaceMarkers = new Set([
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'rush.json',
  'go.work',
]);
const manifests = new Set([
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
]);

export function allowedFoundFolder(folder: string, context: FoundRootContext): boolean {
  folder = folder.replace(/^\/System\/Volumes\/Data(?=\/)/, '');
  if (context.nonLocalRoots?.some((root) => insideRoot(root, folder))) return false;
  if (!remembersFolder(folder) || !folder.startsWith('/') || folder.includes('//')) return false;
  const parts = folder.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || excluded.has(part))) return false;
  if (
    parts.some((part) => part.toLowerCase() === 'homebrew') ||
    /^\/Volumes\/[^/]+\/(?:System|Library|Applications|usr|opt)(?:\/|$)/.test(folder)
  )
    return false;
  if (
    parts.some((part) =>
      /\.(?:app|bundle|framework|plugin|kext|photoslibrary|xcodeproj|xcworkspace)$/i.test(part),
    )
  )
    return false;
  const local =
    insideRoot(context.home, folder) ||
    insideRoot('/Users/Shared', folder) ||
    context.localVolumes?.some(
      (volume) => /^\/Volumes\/[^/]+$/.test(volume) && insideRoot(volume, folder),
    );
  if (!local) return false;
  const relative = insideRoot(context.home, folder) ? folder.slice(context.home.length) : folder;
  if (relative.split('/').some((part) => part.startsWith('.'))) return false;
  if (insideRoot(context.home.toLowerCase() + '/library', folder.toLowerCase())) return false;
  return true;
}

export function rootAncestors(folder: string, context: FoundRootContext): string[] {
  const result: string[] = [];
  for (let path = folder; result.length < 16; path = parentFolder(path)) {
    if (
      !allowedFoundFolder(path, context) ||
      path === context.home ||
      path === '/Users/Shared' ||
      /^\/Volumes\/[^/]+$/.test(path) ||
      (parentFolder(path).toLowerCase() === context.home.toLowerCase() &&
        homeFolders.has(path.split('/').at(-1)!.toLowerCase()))
    )
      break;
    result.push(path);
    if (path === context.scopeRoot) break;
  }
  return result;
}

export function rootFor(
  folder: string,
  probes: ReadonlyMap<string, RootProbe>,
  context: FoundRootContext,
): string | undefined {
  // Not a Workspace: a hidden root's folders belong to no found workspace at or around it, only to
  // roots inside it, such as the inner repositories of a hidden monorepo.
  const ancestors = rootAncestors(folder, context);
  const hiddenAt = ancestors.findIndex((path) => context.hidden?.includes(path));
  const paths = hiddenAt < 0 ? ancestors : ancestors.slice(0, hiddenAt);
  const known = paths.filter((path) => probes.has(path));
  const recognized = known.filter((path) => {
    const facts = probes.get(path)!;
    return (
      facts.git ||
      facts.markers.some(
        (name) =>
          workspaceMarkers.has(name) ||
          manifests.has(name) ||
          /\.(?:xcodeproj|xcworkspace)$/.test(name),
      )
    );
  });
  // Build folder names are meaningful only beneath a recognized project.
  if (
    recognized.some((root) =>
      folder
        .slice(root.length + 1)
        .split('/')
        .some((part) => buildOutputs.has(part)),
    )
  )
    return;
  // A hidden inner repository still counts toward the outer one giving way: hiding one of two
  // inner repositories must not fold the other into the outer repository. Hidden roots are left
  // out only as roots themselves.
  const gitRoots = [...probes]
    .filter(([, facts]) => facts.git === 'directory')
    .map(([path]) => path);
  return (
    known.findLast(
      (path) =>
        probes.get(path)!.git === 'directory' &&
        gitRoots.filter((inner) => inner !== path && insideRoot(path, inner)).length < 2,
    ) ??
    known.find((path) => {
      const git = probes.get(path)!.git;
      return git === 'file' || git === 'worktree' || git === 'submodule';
    }) ??
    known.findLast((path) => {
      const facts = probes.get(path)!;
      return facts.package?.workspaces || facts.markers.some((name) => workspaceMarkers.has(name));
    }) ??
    known.find((path) =>
      probes
        .get(path)!
        .markers.some((name) => manifests.has(name) || /\.(?:xcodeproj|xcworkspace)$/.test(name)),
    )
  );
}
