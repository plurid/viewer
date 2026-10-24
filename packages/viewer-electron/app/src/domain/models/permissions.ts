import type { ModelProvider } from '../services';

export const modelDataLevels = ['names', 'excerpts', 'full-text'] as const;
export type ModelDataLevel = (typeof modelDataLevels)[number];
export interface ModelDataPermission {
  providerID: string;
  kind: ModelProvider['kind'];
  endpoint: string;
  level: ModelDataLevel;
  /** Actions agents start may send this data too. Approved apart, and cleared when the level is
   * approved anew: an agent-started recipe reused the person's own approval (2026-10-20). */
  agents?: boolean;
}
export const modelDataLabels: Record<ModelDataLevel, string> = {
  names: 'filenames and file metadata',
  excerpts: 'filenames, metadata and document excerpts',
  'full-text': 'filenames, metadata and extracted document text',
};
export const modelEndpoint = (provider: Pick<ModelProvider, 'endpoint'>) =>
  new URL(provider.endpoint).href.replace(/\/+$/, '');
export function modelPermissionCovers(
  permission: ModelDataPermission | null,
  provider: Pick<ModelProvider, 'id' | 'kind' | 'endpoint'>,
  level: ModelDataLevel,
  actor: 'user' | 'agent' = 'user',
): boolean {
  return (
    !!permission &&
    (actor !== 'agent' || permission.agents === true) &&
    permission.providerID === provider.id &&
    permission.kind === provider.kind &&
    permission.endpoint === modelEndpoint(provider) &&
    modelDataLevels.indexOf(permission.level) >= modelDataLevels.indexOf(level)
  );
}
