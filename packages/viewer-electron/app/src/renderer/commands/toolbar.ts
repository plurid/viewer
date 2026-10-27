import type { Pane } from '../../domain/contracts';
import { previewModules } from '../previews/registry';
import { getState, receiveSettings } from '../state/store';
import { toolbarCommands, toolbarsSchema } from '../../domain/preferences/toolbars';

/** Preview module identities, rather than extensions, group the same tools together. */
export function toolbarKind(pane: Pane | undefined): string | undefined {
  if (!pane) return undefined;
  if (pane.type !== 'preview') return pane.type;
  const extension = pane.path.split('.').at(-1)?.toLowerCase() ?? '';
  const module = previewModules.find((item) => item.formats.includes(extension));
  return 'preview:' + (module?.id ?? 'fallback');
}
export const pinnedCommands = (kind: string) =>
  toolbarCommands(getState().settings.settings.toolbars, kind);
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
