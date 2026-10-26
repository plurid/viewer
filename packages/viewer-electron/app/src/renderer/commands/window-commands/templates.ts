import { effectiveWindowSettings } from '../../state/effective-ui';
import {
  captureTemplate,
  templatePath,
  type LayoutTemplate,
} from '../../../domain/workspaces/layout-templates';
import {
  activeWorkspace,
  addPane,
  addScratchPane,
  addSearchPane,
  addTerminalPane,
  getState,
  receiveSettings,
} from '../../state/store';
import { setTiling } from '../../state/workspaces';
import { readingOrder, visiblePlanes } from '../../keys/planes';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** The workspace's planes as a template: the tiled ones in order, or those in view as read. */
export function captureCurrentLayout(name: string): LayoutTemplate {
  const space = activeWorkspace();
  const order =
    space.tiling?.panes ??
    (() => {
      const seen = readingOrder(visiblePlanes()).map((plane) => plane.paneID);
      return seen.length ? [...new Set(seen)] : space.roots;
    })();
  const settings = effectiveWindowSettings(getState()).tiling;
  return captureTemplate(name, space.panes, order, getState().bootstrap.home, {
    layout: space.tiling?.layout ?? (order.length > 3 ? 'tiled' : settings.defaultLayout),
    main: space.tiling?.main ?? 0.6,
  });
}
async function saveLayouts(layouts: LayoutTemplate[]): Promise<void> {
  receiveSettings(
    await window.viewer.settingsPatch(
      [{ path: 'settings.layouts', value: layouts }],
      getState().settings.revision,
    ),
  );
}
export const saveLayoutTemplate = (template: LayoutTemplate) =>
  saveLayouts([...getState().settings.settings.layouts, template]);
/**
 * Layout templates: Save layout as template… keeps the planes in view and their
 * tiling; Open layout adds them, tiled, to the workspace in view, wherever it is.
 */
export function templateCommands({
  actions,
  state,
  windowScope,
}: WindowScopes): CommandDefinition[] {
  const layouts = state.settings.settings.layouts;
  const open = (template: LayoutTemplate) => {
    const space = activeWorkspace();
    if (space.panes.length + template.planes.length > 200)
      throw new Error(
        `“${template.name}” opens ${template.planes.length} planes: close some first.`,
      );
    const home = getState().bootstrap.home;
    const active = space.panes.find((pane) => pane.id === getState().activePane);
    const current = active?.type === 'folder' || active?.type === 'terminal' ? active.path : home;
    const path = (value: string) => templatePath(value, home, current);
    const panes = template.planes.map((plane) =>
      plane.kind === 'folder'
        ? addPane(path(plane.path), 'folder', true).id
        : plane.kind === 'file'
          ? addPane(path(plane.path), 'preview', true).id
          : plane.kind === 'terminal'
            ? addTerminalPane(
                path(plane.path),
                plane.profileID ?? getState().settings.settings.terminals.profileID,
                true,
              ).id
            : plane.kind === 'scratch'
              ? addScratchPane().id
              : addSearchPane(
                  plane.query,
                  plane.name,
                  plane.root === undefined ? undefined : path(plane.root),
                  plane.recursive ?? true,
                  plane.content ?? false,
                ),
    );
    setTiling({ panes, layout: template.layout, main: template.main });
    actions.workspace.retile();
  };
  return [
    {
      id: 'layout-save-as',
      label: 'Save layout as template…',
      group: 'Workspace',
      icon: 'grid',
      aliases: ['template', 'layout', 'save layout', 'session'],
      when: (context) =>
        windowScope(context) && actions.ready && activeWorkspace().panes.length > 0,
      run: () => actions.templateDialog(),
    },
    ...layouts.map((template): CommandDefinition => ({
      id: `layout.${template.id}`,
      label: `Open layout “${template.name}”`,
      group: 'Workspace',
      icon: 'grid',
      aliases: ['template', 'layout', template.name],
      detail: `${template.planes.length} planes`,
      when: (context) => windowScope(context) && actions.ready,
      run: () => open(template),
    })),
    ...layouts.map((template): CommandDefinition => ({
      id: `layout-remove.${template.id}`,
      label: `Remove layout “${template.name}”`,
      group: 'Workspace',
      icon: 'trash',
      aliases: ['template', 'layout', 'delete layout'],
      when: windowScope,
      run: () =>
        saveLayouts(getState().settings.settings.layouts.filter((item) => item.id !== template.id)),
    })),
  ];
}
