import { useEffect, useRef, useState } from 'react';
import { missingDefinitionCode } from '../../domain/definitions';
import {
  projectDefinitionSchema,
  projectReference,
  type ProjectAssociation,
  type ProjectDefinition,
  type ProjectDocument,
  type ProjectLayout,
  type PortableDiffSource,
} from '../../domain/workspaces/project';
import { parentPath } from '../../domain/workspaces/planes';
import type {
  Pane,
  ScratchPane,
  NotePane,
  ChatPane,
  ServerPane,
  JournalPane,
  OverviewPane,
  BrowserPane,
  MediaPane,
  LayoutPane,
  TaskPane,
  ReceiptPane,
} from '../../domain/contracts';
import type { DiffSource } from '../../domain/comparison/diff';
import {
  activeWorkspace,
  associateProject,
  closeProject,
  changeWorkspace,
  folderPresentation,
  installProject,
  previewValues,
  projectFolderReferences,
  report,
  getState,
  useViewer,
} from '../state/store';
import { Dialog, NameDialog, PathField } from '../ui/primitives';
import { useWorkspace } from './context';
import { errorMessage } from '../../domain/errors';
import { sendWindowEvent, useWindowEvent } from '../app/window-events';

export type ProjectCommand =
  'open' | 'create' | 'save' | 'reload' | 'close' | 'arrangements' | 'bindings';
export function requestProject(command: ProjectCommand): void {
  sendWindowEvent('viewer:project', command);
}
/** External edits are discovered through the existing bounded folder watcher, never auto-applied. */
export function ProjectFileNotice() {
  const space = useViewer(activeWorkspace),
    project = space.project;
  const [changed, setChanged] = useState<string>(),
    [problem, setProblem] = useState<{ message: string; missing: boolean }>();
  const [ignored, setIgnored] = useState<string>();
  useEffect(() => {
    setChanged(undefined);
    setProblem(undefined);
    setIgnored(undefined);
    if (!project) return;
    let alive = true,
      pending = false,
      again = false;
    const subscriber = 'project-definition:' + space.id + ':' + crypto.randomUUID();
    const isCurrent = () => {
      const current = activeWorkspace(getState());
      return alive && current.id === space.id && current.project?.file === project.file;
    };
    const failed = (error: { message: string; code?: string }) => {
      if (isCurrent())
        setProblem({ message: error.message, missing: error.code === missingDefinitionCode });
    };
    const inspect = async () => {
      if (pending) {
        again = true;
        return;
      }
      pending = true;
      try {
        const document = await readProject(project.file);
        const current = activeWorkspace(getState());
        if (isCurrent() && current.project?.file === document.file) {
          setChanged(
            document.revision === current.project!.revision ? undefined : document.revision,
          );
          setProblem(undefined);
          setIgnored((value) => (value?.startsWith('problem:') ? undefined : value));
        }
      } catch (error) {
        failed(error as Error & { code?: string });
      } finally {
        pending = false;
        if (alive && again) {
          again = false;
          void inspect();
        }
      }
    };
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'folder-changed' && event.path === project.root) void inspect();
      if (event.type === 'watch-error' && event.path === project.root)
        failed({ message: event.message });
    });
    void window.viewer
      .watch(project.root, subscriber)
      .then(() => {
        if (alive) void inspect();
        else void window.viewer.unwatch(subscriber).catch(report);
      })
      .catch((error) => {
        failed(error);
      });
    return () => {
      alive = false;
      remove();
      void window.viewer.unwatch(subscriber).catch(report);
    };
    // Re-watch only for another project file or revision, not for in-memory edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.id, project?.file, project?.revision]);
  const noticeID = problem
    ? 'problem:' + problem.message
    : changed
      ? 'revision:' + changed
      : undefined;
  if (!project || !noticeID || noticeID === ignored) return null;
  return (
    <div className="bar project-file-notice" role="status">
      <span title={project.file}>
        {problem?.missing
          ? 'Project file is missing. Your open planes are still available.'
          : problem
            ? 'Project file: ' + problem.message
            : 'Project file changed on disk.'}
      </span>
      {!problem?.missing && (
        <button onClick={() => requestProject('reload')}>
          {problem ? 'Retry…' : 'Review updated project…'}
        </button>
      )}
      <button onClick={() => requestProject('close')}>Close project</button>
      <button
        onClick={() => {
          setIgnored(noticeID);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
/** The folders a new project binds: each outside it that a plane shows, as `external-n`. A scratch
 * plane's folder is only where Save As starts, so it binds nothing. */
export function projectBindings(root: string, panes: readonly Pane[]): Record<string, string> {
  const bindings: Record<string, string> = {};
  const bind = (path: string, directory: boolean) => {
    try {
      projectReference(root, path, bindings);
    } catch {
      bindings['external-' + (Object.keys(bindings).length + 1)] = directory
        ? path
        : parentPath(path);
    }
  };
  for (const pane of panes) {
    if (
      pane.type === 'scratch' ||
      pane.type === 'note' ||
      pane.type === 'chat' ||
      pane.type === 'server' ||
      pane.type === 'browser' ||
      pane.type === 'media' ||
      pane.type === 'layout' ||
      pane.type === 'task' ||
      pane.type === 'receipt' ||
      pane.type === 'journal' ||
      pane.type === 'overview'
    )
      continue;
    bind(pane.path, pane.type === 'folder' || pane.type === 'git-changes');
    if (pane.type === 'diff') {
      for (const source of [pane.left, pane.right]) {
        if (source.kind === 'file') bind(source.path, false);
        if (source.kind === 'git') bind(source.repository, true);
      }
    }
  }
  return bindings;
}
async function readProject(file: string): Promise<ProjectDocument> {
  const reply = await window.viewer.project({ kind: 'read', file });
  if (!reply || typeof reply !== 'object') throw new Error('The project could not be opened.');
  return reply;
}
function definition(project: ProjectAssociation, layout: ProjectLayout): ProjectDefinition {
  const space = activeWorkspace();
  // Private documents and runtime server controls stay in this Mac's workspace.
  const shared = space.panes.filter(
    (
      pane,
    ): pane is Exclude<
      Pane,
      | ScratchPane
      | NotePane
      | ChatPane
      | ServerPane
      | JournalPane
      | BrowserPane
      | MediaPane
      | LayoutPane
      | TaskPane
      | ReceiptPane
      | OverviewPane
    > =>
      pane.type !== 'scratch' &&
      pane.type !== 'note' &&
      pane.type !== 'chat' &&
      pane.type !== 'server' &&
      pane.type !== 'browser' &&
      pane.type !== 'media' &&
      pane.type !== 'layout' &&
      pane.type !== 'task' &&
      pane.type !== 'receipt' &&
      pane.type !== 'journal' &&
      pane.type !== 'overview',
  );
  const source = (value: DiffSource): PortableDiffSource => {
    if (value.kind === 'empty') return value;
    if (value.kind === 'file')
      return { kind: 'file', target: projectReference(project.root, value.path, project.bindings) };
    return {
      kind: 'git',
      target: projectReference(project.root, value.repository, project.bindings),
      commit: value.commit,
      path: value.path,
    };
  };
  const planes: ProjectDefinition['planes'] = shared.map((pane) => {
    const target = projectReference(project.root, pane.path, project.bindings);
    const state = Object.fromEntries(
      Object.entries(previewValues(pane.id)).filter(([key]) => key !== '_sourceVersion'),
    );
    if (pane.type === 'folder') return { id: pane.id, type: pane.type, target, state };
    if (pane.type === 'preview') return { id: pane.id, type: pane.type, target, state };
    if (pane.type === 'terminal')
      return {
        id: pane.id,
        type: pane.type,
        target,
        state,
        profileID: pane.profileID,
        ...(pane.gitAction ? { gitAction: pane.gitAction } : {}),
      };
    if (pane.type === 'collection')
      return { id: pane.id, type: pane.type, target, state, collectionID: pane.collectionID };
    if (pane.type === 'git-changes') return { id: pane.id, type: pane.type, target, state };
    if (pane.type === 'diff')
      return {
        id: pane.id,
        type: pane.type,
        target,
        state,
        left: source(pane.left),
        right: source(pane.right),
        mode: pane.mode,
      };
    return {
      id: pane.id,
      type: pane.type,
      target,
      state,
      query: pane.query,
      name: pane.name,
      recursive: pane.recursive ?? true,
      content: pane.content ?? false,
    };
  });
  // Unbound planes remain in the definition until the user binds or removes them.
  for (const plane of project.definition.planes)
    if (plane.target.binding && !Object.hasOwn(project.bindings, plane.target.binding))
      planes.push(plane);
  const known = new Set(planes.map((plane) => plane.id));
  const shown = new Set(layout.placements.map((plane) => plane.id));
  const placements = [
    ...layout.placements.filter((plane) => known.has(plane.id)),
    ...project.definition.layout.placements.filter(
      (plane) => known.has(plane.id) && !shown.has(plane.id),
    ),
  ];
  return projectDefinitionSchema.parse({
    ...project.definition,
    name: space.name,
    planes,
    folders: projectFolderReferences(project),
    collections: [
      ...(space.collections ?? []).map((collection) => ({
        ...collection,
        sources: [
          ...collection.sources.map((file) =>
            projectReference(project.root, file, project.bindings),
          ),
          ...(project.definition.collections
            ?.find((value) => value.id === collection.id)
            ?.sources.filter(
              (target) => target.binding && !Object.hasOwn(project.bindings, target.binding),
            ) ?? []),
        ],
      })),
      ...(project.definition.collections ?? []).filter(
        (collection) => !(space.collections ?? []).some((value) => value.id === collection.id),
      ),
    ],
    layout: {
      ...layout,
      placements: placements.map((plane) => ({
        ...plane,
        parent: plane.parent && known.has(plane.parent) ? plane.parent : undefined,
      })),
    },
    arrangements: Object.fromEntries(
      Object.entries(project.definition.arrangements).filter(([, arrangement]) =>
        arrangement.placements.every((plane) => known.has(plane.id)),
      ),
    ),
  });
}
/** A project save is explicit; opening, arranging and folder view edits stay private. */
export function ProjectControls() {
  const workspace = useWorkspace();
  const space = useViewer(activeWorkspace);
  const [panel, setPanel] = useState<'arrangements' | 'bindings' | null>(null);
  const [reload, setReload] = useState<ProjectDocument>();
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(0);
  useEffect(() => {
    operation.current++;
    setPanel(null);
    setReload(undefined);
    setNaming(false);
    setBusy(false);
    setError('');
  }, [space.id]);
  useWindowEvent('viewer:project', (command) => {
    if (command === 'close') {
      operation.current++;
      closeProject();
      setPanel(null);
      setReload(undefined);
      setNaming(false);
      setBusy(false);
      setError('');
      return;
    }
    if (command === 'arrangements' || command === 'bindings') {
      setPanel(command);
      return;
    }
    if (busy) return;
    const token = ++operation.current;
    const owner = activeWorkspace().id;
    const isCurrent = () => token === operation.current && activeWorkspace().id === owner;
    setBusy(true);
    setError('');
    void (async () => {
      if (command === 'open') {
        const file = await window.viewer.project({ kind: 'choose', mode: 'open' });
        if (typeof file === 'string' && isCurrent()) {
          const document = await readProject(file);
          if (!isCurrent()) return;
          await installProject(document);
          if (
            document.definition.bindings.some(
              (binding) => !activeWorkspace().project?.bindings[binding.name],
            )
          )
            setPanel('bindings');
        }
        return;
      }
      const current = activeWorkspace();
      let project = current.project;
      if (command === 'reload') {
        if (project) {
          const document = await readProject(project.file);
          if (isCurrent()) setReload(document);
        }
        return;
      }
      if (!project || command === 'create') {
        const file = await window.viewer.project({
          kind: 'choose',
          mode: 'create',
          defaultPath: current.panes.find((pane) => pane.type === 'folder')?.path,
        });
        if (typeof file !== 'string' || !isCurrent()) return;
        const root = parentPath(file);
        const bindings = projectBindings(root, current.panes);
        project = {
          file,
          root,
          revision: '',
          bindings,
          dirty: true,
          folders: Object.fromEntries(
            current.panes
              .filter((pane) => pane.type === 'folder')
              .map((pane) => [pane.path, folderPresentation(pane.path)]),
          ),
          definition: {
            version: 1,
            id: crypto.randomUUID(),
            name: current.name,
            bindings: Object.keys(bindings).map((name) => ({ name, label: name })),
            planes: [],
            folders: [],
            layout: { placements: [] },
            arrangements: {},
          },
        };
      }
      const input = definition(project, workspace.captureLayout());
      const reply = await window.viewer.project({
        kind: 'save',
        file: project.file,
        revision: project.revision,
        definition: input,
      });
      if (!reply || typeof reply !== 'object') throw new Error('The project was not saved.');
      if (isCurrent()) associateProject({ ...project, ...reply, dirty: false });
    })()
      .catch((error) => {
        if (isCurrent()) report(error);
      })
      .finally(() => {
        if (isCurrent()) setBusy(false);
      });
  });
  const project = space.project;
  if (reload)
    return (
      <Dialog title="Reload project?" onClose={() => !busy && setReload(undefined)}>
        <div className="dialog-body">
          <p>
            Replace this workspace's open planes, folder views and layout with the saved project?
          </p>
          {project?.dirty && (
            <p>Your private session has changes that have not been saved to the project file.</p>
          )}
          <PathField className="muted" path={reload.file} />
        </div>
        <footer>
          <button disabled={busy} onClick={() => setReload(undefined)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void installProject(reload, project?.bindings)
                .then(() => setReload(undefined))
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            Reload project
          </button>
        </footer>
      </Dialog>
    );
  if (naming && project)
    return (
      <NameDialog
        title="Save arrangement"
        initial=""
        action="Save"
        onClose={() => setNaming(false)}
        onSubmit={(name) => {
          const layout = workspace.captureLayout();
          changeWorkspace((current) => ({
            ...current,
            project: {
              ...current.project!,
              definition: {
                ...current.project!.definition,
                arrangements: {
                  ...current.project!.definition.arrangements,
                  [name]: layout,
                },
              },
            },
          }));
          setNaming(false);
          requestProject('save');
        }}
      />
    );
  if (!panel) return null;
  return (
    <Dialog
      title={panel === 'bindings' ? 'Project folders' : 'Saved arrangements'}
      onClose={() => !busy && setPanel(null)}
    >
      <div className="dialog-body project-controls">
        {!project ? (
          <p>Create or open a project first.</p>
        ) : panel === 'bindings' ? (
          <>
            <p className="muted">
              External locations are saved on this Mac. Choosing a folder authorizes that location.
            </p>
            {project.definition.bindings.length === 0 && (
              <p>All planes are inside the project folder.</p>
            )}
            {project.definition.bindings.map((binding) => (
              <div className="project-control-row" key={binding.name}>
                <div>
                  <strong>{binding.label}</strong>
                  <p className="muted">
                    {project.bindings[binding.name] || 'Choose this folder to restore its planes'}
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void window.viewer
                      .chooseFolder(project.bindings[binding.name])
                      .then(async (path) => {
                        if (path)
                          await installProject(
                            {
                              file: project.file,
                              root: project.root,
                              revision: project.revision,
                              definition: definition(project, workspace.captureLayout()),
                            },
                            { ...project.bindings, [binding.name]: path },
                          );
                      })
                      .catch((error: Error) => setError(error.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Choose…
                </button>
              </div>
            ))}
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void window.viewer
                  .chooseFolder()
                  .then((path) => {
                    if (!path) return;
                    const current = activeWorkspace().project!;
                    let count = 1;
                    while (
                      current.definition.bindings.some(
                        (binding) => binding.name === 'external-' + count,
                      )
                    )
                      count++;
                    const name = 'external-' + count;
                    changeWorkspace((space) => ({
                      ...space,
                      project: {
                        ...current,
                        bindings: { ...current.bindings, [name]: path },
                        definition: {
                          ...current.definition,
                          bindings: [
                            ...current.definition.bindings,
                            {
                              name,
                              label: path.split(/[\\/]/).at(-1) || name,
                            },
                          ],
                        },
                      },
                    }));
                  })
                  .catch((error: Error) => setError(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              Add external folder…
            </button>
          </>
        ) : (
          <>
            {Object.keys(project.definition.arrangements).length === 0 && (
              <p>No saved arrangements.</p>
            )}
            {Object.keys(project.definition.arrangements).map((name) => (
              <div className="project-control-row" key={name}>
                <span>{name}</span>
                <button
                  onClick={() => {
                    try {
                      const layout = project.definition.arrangements[name];
                      if (layout) workspace.restoreLayout(layout);
                      setPanel(null);
                    } catch (error) {
                      setError(errorMessage(error));
                    }
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                setPanel(null);
                setNaming(true);
              }}
            >
              Save current arrangement…
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button disabled={busy} onClick={() => setPanel(null)}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
