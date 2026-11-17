import { createHash } from 'node:crypto';
import type { Workspace } from '../src/domain/contracts';
import type {
  WorkspaceDefinition,
  WorkspaceProject,
} from '../src/domain/workspaces/definitions/schema';
import { workspacesFileSchema } from '../src/domain/workspaces/definitions/schema';
import { resolveCatalog } from '../src/domain/workspaces/definitions/catalog';

export const hashDefinition = (text: string) => createHash('sha256').update(text).digest('hex');
export const sampleProject = (
  key = 'sample/site',
  extra: Partial<WorkspaceProject> = {},
): WorkspaceProject => ({
  key,
  name: key.split('/').join(' > '),
  root: '/projects/' + key,
  paths: [],
  tags: [],
  ...extra,
});
export const sampleDefinition = (
  key = 'sample/site',
  extra: Partial<WorkspaceDefinition> = {},
): WorkspaceDefinition => ({
  ...resolveCatalog({
    file: workspacesFileSchema.parse({ version: 1 }),
    projects: [sampleProject(key)],
    home: '/home/sample',
    hash: hashDefinition,
  }).definitions[0]!,
  ...extra,
});
export const sampleWorkspace = (id = 'open', extra: Partial<Workspace> = {}): Workspace => ({
  id,
  name: 'Open workspace',
  panes: [],
  roots: [],
  arrangement: {},
  ...extra,
});
export const syntheticDefinitions = () => {
  const siblings = [
    'plume/technologies/tools/plume-cli',
    'plume/technologies/tools/viewer',
    'plume/technologies/tools/package-linker',
    'plume/technologies/tools/plane-client',
    'plume/technologies/tools/project-library',
    'clients/acme/plume-site',
    'clients/cedar/plume-web',
    'clients/plume/cli',
  ];
  return [
    ...siblings,
    ...Array.from({ length: 324 - siblings.length }, (_, index) =>
      index % 2
        ? `clients/client-${index}/plume-site`
        : `plume/technologies/tools/package-library-${index}`,
    ),
  ].map((key) => sampleDefinition(key));
};
