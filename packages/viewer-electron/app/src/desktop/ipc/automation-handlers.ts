import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ApiHandlers } from './schemas';
import type { Lenses } from '../workspaces/lenses';
import type { Projects } from '../workspaces/projects';
import type { Relationships } from '../workspaces/relationships';
import type { Workflows } from '../automation/workflows';
import type { WatchRules } from '../automation/watch-rules';
import { chooseRemembered, type DialogAccess } from '../native/dialogs';

type AutomationHandlers = Pick<
  ApiHandlers,
  'lens' | 'project' | 'workflow' | 'watchRules' | 'relationships'
>;
interface AutomationPorts {
  lenses: Pick<Lenses, 'list' | 'create' | 'apply' | 'trash' | 'share' | 'collapse'>;
  projects: Pick<Projects, 'read' | 'save'>;
  workflows: Pick<Workflows, 'request'>;
  watchRules: Pick<WatchRules, 'request'>;
  relationships: Pick<Relationships, 'request'>;
  fileAccess: DialogAccess;
  requireWindow(owner: number): BrowserWindow;
}

/** A workflow started here runs as the person's: a renderer cannot claim an agent's client. */
export function createAutomationHandlers(ports: AutomationPorts): AutomationHandlers {
  return {
    lens: async ([request]) => {
      if (request.kind === 'list') return ports.lenses.list(request.folder);
      if (request.kind === 'create')
        return ports.lenses.create(request.folder, request.name, request.ops);
      if (request.kind === 'apply')
        return ports.lenses.apply(request.folder, request.file, request.ops);
      if (request.kind === 'trash') return ports.lenses.trash(request.folder, request.file);
      if (request.kind === 'share') return ports.lenses.share(request.folder, request.file);
      await ports.lenses.collapse(request.lens, request.groups);
      return null;
    },
    project: async ([request], owner) => {
      if (request.kind === 'read') return ports.projects.read(request.file);
      if (request.kind === 'save')
        return ports.projects.save(request.file, request.revision, request.definition);
      const folder = await chooseRemembered(
        ports.fileAccess,
        ports.requireWindow(owner),
        {
          title: request.mode === 'open' ? 'Open Project Folder' : 'Create Project in Folder',
          buttonLabel: request.mode === 'open' ? 'Open Project' : 'Choose Folder',
          properties: ['openDirectory'],
          defaultPath: request.defaultPath,
        },
        true,
      );
      if (!folder) return null;
      return path.join(folder, 'viewer.project.jsonc');
    },
    workflow: async ([request], owner) => {
      if (request.kind !== 'choose')
        return ports.workflows.request(
          request.kind === 'start'
            ? { ...request, context: { ...request.context, actor: 'user', clientID: undefined } }
            : request,
        );
      const create = request.mode === 'create';
      const chosen = await chooseRemembered(
        ports.fileAccess,
        ports.requireWindow(owner),
        {
          title: create ? 'Create Workflow in Folder' : 'Open Workflow',
          buttonLabel: create ? 'Choose Folder' : 'Open Workflow',
          properties: create ? ['openDirectory'] : ['openFile'],
          defaultPath: request.defaultPath,
          ...(request.mode === 'open'
            ? { filters: [{ name: 'Workflow JSONC', extensions: ['jsonc', 'json'] }] }
            : {}),
        },
        create,
      );
      if (!chosen) return null;
      return create ? path.join(chosen, 'viewer.workflow.jsonc') : chosen;
    },
    watchRules: ([request]) => ports.watchRules.request(request),
    relationships: ([request]) => ports.relationships.request(request),
  };
}
