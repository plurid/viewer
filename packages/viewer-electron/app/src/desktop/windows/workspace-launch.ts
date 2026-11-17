import type { LaunchRequest } from '../../domain/workspaces/launch';
import type { WorkspaceQueryResult } from '../../domain/workspaces/definitions/query';

interface WorkspaceLaunchPorts<Window> {
  current?: Window;
  forWorkspace(id: string): Window | undefined;
  create(id?: string): Promise<Window | undefined>;
  independent(): Promise<Window | undefined>;
}

/** A query with no match is recoverable in the picker, including before the first window exists. */
export async function routeWorkspaceLaunch<Window>(
  request: LaunchRequest,
  result: WorkspaceQueryResult,
  ports: WorkspaceLaunchPorts<Window>,
): Promise<{ target?: Window; request: LaunchRequest }> {
  if (result.kind === 'open')
    return {
      target: ports.forWorkspace(result.workspaceID) ?? (await ports.create(result.workspaceID)),
      request,
    };
  if (result.kind === 'defined')
    return { target: await ports.independent(), request: { ...request, definition: result.key } };
  return {
    target: ports.current ?? (await ports.create()),
    request: { ...request, workspacePicker: result.query },
  };
}
