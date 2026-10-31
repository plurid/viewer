import type { Pane } from '../../domain/contracts';
import type { CommandContext, CommandRequest } from './registry';
import { previewModules } from '../previews/registry';
import { getState, receiveSettings } from '../state/store';
import { toolbarsSchema } from '../../domain/preferences/toolbars';

export function toolbarRequest(
  pane: Pane,
  target: CommandContext | undefined,
  scope: CommandRequest['scope'],
): CommandRequest {
  const owned = target?.paneID === pane.id ? target : undefined;
  // Window context may still belong to another plane when this inactive header is clicked.
  // Shared clipboard/jobs survive; every plane-specific capability belongs to this target only.
  return {
    paneID: pane.id,
    scope: owned?.selection.length ? 'files' : scope,
    context: {
      ...target,
      paneID: pane.id,
      path: pane.path,
      selection: owned?.selection ?? [],
      subject: owned?.subject,
      folder: pane.type === 'folder' ? pane : owned?.folder,
      directory:
        owned?.directory ??
        (['folder', 'terminal', 'server'].includes(pane.type) ? pane.path : undefined),
      resourceID: owned?.resourceID,
      rootID: owned?.rootID,
      searchOpen: owned?.searchOpen,
      sidebar: owned?.sidebar,
      lensGroup: owned?.lensGroup,
    },
  };
}

/** Preview module identities, rather than extensions, group the same tools together. */
export function toolbarKind(pane: Pane | undefined): string | undefined {
  if (!pane) return undefined;
  if (pane.type !== 'preview') return pane.type;
  const extension = pane.path.split('.').at(-1)?.toLowerCase() ?? '';
  const module = previewModules.find((item) => item.formats.includes(extension));
  return 'preview:' + (module?.id ?? 'fallback');
}
export async function saveToolbar(
  kind: string,
  commands: readonly string[] | undefined,
): Promise<void> {
  const state = getState().settings;
  const toolbars = { ...state.settings.toolbars };
  if (commands) toolbars[kind] = [...commands];
  else delete toolbars[kind];
  toolbarsSchema.parse(toolbars);
  const snapshot = await window.viewer.settingsPatch(
    [{ path: 'settings.toolbars', value: toolbars }],
    state.revision,
  );
  receiveSettings(snapshot);
}
