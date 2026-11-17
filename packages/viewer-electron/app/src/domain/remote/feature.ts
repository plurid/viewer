export interface RemoteEnvironment {
  VIEWER_REMOTE?: string;
}

/** Callers supply the environment so the domain never reads process or build globals. */
export function remoteFeatureEnabled(environment: RemoteEnvironment = {}): boolean {
  return environment.VIEWER_REMOTE === '1';
}
