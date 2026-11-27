/**
 * A scene's starting state as an app data profile: settings and saved state on disk.
 *
 * The packaged app under review can be older or newer than this source, and its configuration
 * refuses keys it does not know. So the profile starts from the settings the app itself reports on
 * a first launch (its template) and changes only keys that template has.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sampleFolders, sampleProject, workspaceName } from './samples';
import type { SceneSetup, Variant } from './types';

type JSONObject = Record<string, unknown>;

/** The binary's own defaults, read once a run. */
export interface ProfileTemplate {
  settings: JSONObject;
  ui: JSONObject;
  /** The saved-state version the binary writes. */
  stateVersion: number;
}

/** Sets `object.a.b.c` only when the binary knows that key, so its configuration stays valid. */
function setKnown(object: JSONObject, keys: readonly string[], value: unknown): void {
  let target = object;
  for (const key of keys.slice(0, -1)) {
    const next = target[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    target = next as JSONObject;
  }
  const last = keys.at(-1)!;
  if (Object.hasOwn(target, last)) target[last] = value;
}

function folderWorkspace(id: string, name: string, folder: string, view: string, sidebar: boolean) {
  return {
    id,
    name,
    roots: ['folder'],
    activePane: 'folder',
    arrangement: {},
    panes: [
      {
        id: 'folder',
        type: 'folder',
        path: folder,
        mode: view,
        sort: 'name',
        descending: false,
        showHidden: false,
        history: [folder],
        historyIndex: 0,
        sidebar: { visible: sidebar, width: 210 },
      },
    ],
    layout: {
      active: 'folder',
      docked: 'folder',
      placements: [
        {
          id: 'folder',
          width: 1120,
          height: 720,
          show: true,
          location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
        },
      ],
    },
  };
}

/** Writes a new profile in `directory` for this scene and variant. */
export async function writeProfile(
  directory: string,
  home: string,
  setup: SceneSetup,
  variant: Variant,
  template: ProfileTemplate,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const folder = path.join(home, setup.folder);
  const view = setup.view ?? 'list';
  const settings = structuredClone(template.settings);
  setKnown(settings, ['appearance'], variant.look);
  setKnown(settings, ['hotkey', 'enabled'], false);
  setKnown(settings, ['providers'], []);
  if (setup.customActions) setKnown(settings, ['customActions'], setup.customActions);
  setKnown(settings, ['updates', 'checkAtLaunch'], false);
  setKnown(settings, ['browsing', 'findWorkspaces'], false);
  setKnown(settings, ['browsing', 'confirmTrash'], true);
  setKnown(settings, ['search', 'roots'], [home]);
  setKnown(settings, ['search', 'contentRoots'], []);
  // a folder's view is kept by its path
  setKnown(settings, ['folders'], { [folder]: { mode: view } });
  const ui = structuredClone(template.ui);
  setKnown(ui, ['space', 'opening'], 'dock');
  // the window's own navigation column stays closed; the plane's sidebar is the one scenes show
  setKnown(ui, ['sidebar', 'visible'], false);
  setKnown(ui, ['sidebar', 'inNewPlanes'], setup.sidebar ?? false);
  setKnown(ui, ['sidebar', 'collapsed'], setup.recentFolded ? ['recents'] : []);
  setKnown(ui, ['titlebar', 'visible'], setup.titlebar ?? true);
  // a returning person's profile: the first-run card has been seen
  setKnown(ui, ['firstRunHint'], 'retired');
  const workspaces: Record<string, unknown>[] = [
    folderWorkspace('review', workspaceName, folder, view, !!setup.sidebar),
  ];
  if (setup.project) {
    const root = path.join(home, setup.project.root);
    // an unsaved project draft, as Create project leaves it before its first save
    workspaces[0]!.project = {
      file: path.join(root, workspaceName + '.viewer-project'),
      root,
      revision: '',
      bindings: Object.fromEntries(
        Object.entries(setup.project.bindings).map(([name, relative]) => [
          name,
          path.join(home, relative),
        ]),
      ),
      folders: {},
      dirty: true,
      definition: sampleProject(setup.project.bindings),
    };
  }
  for (let index = 1; index <= (setup.extraWorkspaces ?? 0); index++)
    workspaces.push(
      folderWorkspace(
        'project-' + index,
        'Project ' + index + ' for the north workshop',
        path.join(home, sampleFolders.projects),
        'list',
        false,
      ),
    );
  if (setup.otherWorkspace)
    workspaces.push(
      folderWorkspace(
        'other',
        setup.otherWorkspace,
        path.join(home, sampleFolders.projects),
        'list',
        false,
      ),
    );
  const state = {
    version: template.stateVersion,
    look: variant.look,
    ui,
    favorites: [],
    recents: (setup.recents ?? []).map((relative) => path.join(home, relative)),
    activeWorkspace: 'review',
    workspaces,
  };
  await writeFile(
    path.join(directory, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }, null, 2),
    { flag: 'wx' },
  );
  if (setup.missingTerminalFolder) {
    const definitions = {
      version: 1,
      sources: { projectManager: { enabled: false } },
      workspaces: {
        service: {
          name: 'Review service',
          root: folder,
          planes: [{ kind: 'terminal', path: 'not-created', command: 'npm test' }],
        },
      },
    };
    await writeFile(path.join(directory, 'workspaces.jsonc'), JSON.stringify(definitions), {
      flag: 'wx',
    });
  }
  await writeFile(path.join(directory, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
}
