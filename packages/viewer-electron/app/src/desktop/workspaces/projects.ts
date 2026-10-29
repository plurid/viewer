import { projectDefinitionSchema, type ProjectDefinition } from '../../domain/workspaces/project';
import { DefinitionFiles, decodeDefinition } from '../persistence/definition-files';
import { fileCoordination } from '../files/file-coordination';

const projectComments =
  [
    '// Viewer project, version 1. Save Project writes this file only when requested.',
    '// Paths are relative to this file. Moving the whole folder preserves them.',
    '// External folders use binding names. Their absolute locations stay in private',
    '// session state; each machine must choose and authorize those folders itself.',
    '// Folder views apply inside this project only. Draft view edits auto-save privately.',
    '// Layout IDs refer to planes below, never engine-generated IDs.',
    '// Terminal planes are locations only and wait for Start after importing a project.',
    '// Opening or reloading this file never runs commands, workflows or model requests.',
    '// Agents: preserve IDs and comments, declare external bindings, and validate before',
    "// saving. A stale revision prevents overwriting another editor's changes.",
  ].join('\n') + '\n';

export function decodeProject(text: string): ProjectDefinition {
  return decodeDefinition(text, projectDefinitionSchema, 'Project');
}
/** Shared definition I/O keeps JSONC comments, explicit saves and source revisions consistent. */
export class Projects extends DefinitionFiles<ProjectDefinition> {
  constructor(
    access: (files: readonly string[]) => Promise<void>,
    coordination: Pick<typeof fileCoordination, 'run'> = fileCoordination,
  ) {
    super(projectDefinitionSchema, 'Project', projectComments, access, coordination);
  }
}
