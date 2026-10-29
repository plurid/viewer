import type { Pane } from '../contracts';
import type { TileLayout } from './tiling';
import { slugID } from '../ids';

/** A plane a template opens: by kind and folder, not by identity, so it opens anywhere. */
export type TemplatePlane =
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'terminal'; path: string; profileID?: string }
  | { kind: 'scratch' }
  | {
      kind: 'search';
      query: string;
      name: string;
      root?: string;
      recursive?: boolean;
      content?: boolean;
    };
/**
 * Layout templates: a set of planes and their tiling, saved by name in config.jsonc
 * (`settings.layouts`): "Triage" is Downloads, Desktop and a scratch plane side by side, "Dev" a
 * project folder beside two terminals. Opening one adds its planes to the workspace in view.
 */
export interface LayoutTemplate {
  id: string;
  name: string;
  planes: TemplatePlane[];
  layout: TileLayout;
  main: number;
}
/** Home as `~`, so a template reads on any account. */
const tilde = (path: string, home: string) =>
  path === home ? '~' : path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
/** A template's path made absolute: `~` is home; empty is the folder in view. */
export function templatePath(path: string, home: string, current: string): string {
  if (!path) return current;
  if (path === '~' || path.startsWith('~/')) return home + path.slice(1);
  return path;
}
/** A template of `panes` in `order`; kinds a template cannot reopen (collections) are left out. */
export function captureTemplate(
  name: string,
  panes: readonly Pane[],
  order: readonly string[],
  home: string,
  tiling: { layout: TileLayout; main: number },
  taken: Iterable<string> = [],
): LayoutTemplate {
  const planes = order.flatMap((id): TemplatePlane[] => {
    const pane = panes.find((item) => item.id === id);
    if (!pane) return [];
    if (pane.type === 'folder') return [{ kind: 'folder', path: tilde(pane.path, home) }];
    if (pane.type === 'preview') return [{ kind: 'file', path: tilde(pane.path, home) }];
    if (pane.type === 'terminal')
      return [{ kind: 'terminal', path: tilde(pane.path, home), profileID: pane.profileID }];
    if (pane.type === 'scratch') return [{ kind: 'scratch' }];
    if (pane.type === 'search')
      return [
        {
          kind: 'search',
          query: pane.query,
          name: pane.name,
          ...(pane.allLocations ? {} : { root: tilde(pane.path, home) }),
          recursive: pane.recursive,
          content: pane.content,
        },
      ];
    return [];
  });
  return {
    id: slugID(name, 'layout', taken),
    name,
    planes: planes.slice(0, 30),
    layout: tiling.layout,
    main: tiling.main,
  };
}
