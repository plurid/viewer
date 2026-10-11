import { useRef, useState, type DragEvent } from 'react';
import type { SidebarSection } from '../../domain/contracts';
import { reorder } from '../../domain/preferences';
import {
  activeWorkspace,
  addFavorite,
  changePreferences,
  getState,
  report,
  useViewer,
} from '../state/store';
import { useWorkspace } from '../workspace/context';
import { ContextMenu } from './ContextMenu';
import { Icon } from './Icon';
import type { CommandRequest } from '../commands/registry';

const titles = { locations: 'Locations', favorites: 'Favorites', recents: 'Recent' };
export const SIDEBAR_DRAG = 'application/x-viewer-sidebar';
export const SHORTCUT_DRAG = 'application/x-viewer-shortcuts';
type SidebarDrag = { section: SidebarSection; path?: string };
export function readSidebarDrag(data: string): SidebarDrag | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return null;
    const drag = value as Record<string, unknown>;
    if (
      !['locations', 'favorites', 'recents'].includes(String(drag.section)) ||
      (drag.path !== undefined && typeof drag.path !== 'string')
    )
      return null;
    return { section: drag.section as SidebarSection, path: drag.path as string | undefined };
  } catch {
    return null;
  }
}
export function Sidebar() {
  const saved = useViewer((state) => state.saved);
  const bootstrap = useViewer((state) => state.bootstrap);
  const space = useViewer(activeWorkspace);
  const active = useViewer((state) => state.activePane);
  const workspace = useWorkspace();
  const sidebar = saved.ui.sidebar;
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest } | null>(null);
  const [drop, setDrop] = useState('');
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const current = space.panes.find((pane) => pane.id === active)?.path;
  const order = [
    ...sidebar.locations,
    ...bootstrap.locations
      .map((item) => item.path)
      .filter((path) => !sidebar.locations.includes(path)),
  ];
  const locations = order
    .flatMap((path) => bootstrap.locations.find((item) => item.path === path) ?? [])
    .filter((item) => !sidebar.hidden.includes(item.path));
  const groups = {
    locations,
    favorites: saved.favorites,
    recents: saved.recents
      .slice(0, 8)
      .map((path) => ({ path, name: path.split(/[\\/]/).pop() || path })),
  };
  function context(
    section: SidebarSection,
    event: React.MouseEvent,
    item?: { path: string; name: string },
  ) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      request: {
        sources: ['window'],
        scope: 'sidebar',
        context: { sidebar: { section, ...item }, selection: [] },
      },
    });
  }
  function drag(event: DragEvent, section: SidebarSection, path?: string) {
    event.stopPropagation();
    event.dataTransfer.setData(SIDEBAR_DRAG, JSON.stringify({ section, path }));
    event.dataTransfer.effectAllowed = 'linkMove';
  }
  async function finishDrop(event: DragEvent, section: SidebarSection, before?: string) {
    event.preventDefault();
    event.stopPropagation();
    setDrop('');
    const dragged = readSidebarDrag(event.dataTransfer.getData(SIDEBAR_DRAG));
    if (dragged && !dragged.path) {
      changePreferences((ui) => ({
        ...ui,
        sidebar: { ...ui.sidebar, order: reorder(ui.sidebar.order, dragged.section, section) },
      }));
      return;
    }
    if (section === 'locations' && dragged?.section === 'locations' && dragged.path) {
      changePreferences((ui) => ({
        ...ui,
        sidebar: { ...ui.sidebar, locations: reorder(order, dragged.path!, before) },
      }));
      return;
    }
    if (section !== 'favorites') return;
    if (dragged?.path) {
      const item = groups[dragged.section].find((item) => item.path === dragged.path);
      if (item) addFavorite(item.path, item.name, before);
      return;
    }
    try {
      const shortcuts: unknown = JSON.parse(event.dataTransfer.getData(SHORTCUT_DRAG));
      if (!Array.isArray(shortcuts) || shortcuts.length > 200) return;
      for (const shortcut of shortcuts) {
        if (!shortcut || typeof shortcut.path !== 'string') continue;
        const entry = await window.viewer.stat(shortcut.path);
        if (entry.directory) addFavorite(entry.path, entry.name, before);
      }
    } catch (error) {
      report(error);
    }
  }
  if (!sidebar.visible) return null;
  return (
    <aside className="location-sidebar" aria-label="Locations" style={{ width: sidebar.width }}>
      <div className="sidebar-scroll">
        {sidebar.order.map((section) => (
          <section
            key={section}
            className={`sidebar-group ${drop === section ? 'sidebar-drop' : ''}`}
            onDragOver={(event) => {
              const supported =
                event.dataTransfer.types.includes(SIDEBAR_DRAG) ||
                (section === 'favorites' && event.dataTransfer.types.includes(SHORTCUT_DRAG));
              if (!supported) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = section === 'favorites' ? 'link' : 'move';
              setDrop(section);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop('');
            }}
            onDrop={(event) => {
              void finishDrop(event, section).catch(report);
            }}
          >
            <button
              className="sidebar-section-title"
              draggable
              onDragStart={(event) => drag(event, section)}
              aria-expanded={!sidebar.collapsed.includes(section)}
              onContextMenu={(event) => context(section, event)}
              onClick={() =>
                changePreferences((ui) => ({
                  ...ui,
                  sidebar: {
                    ...ui.sidebar,
                    collapsed: ui.sidebar.collapsed.includes(section)
                      ? ui.sidebar.collapsed.filter((item) => item !== section)
                      : [...ui.sidebar.collapsed, section],
                  },
                }))
              }
            >
              <Icon name={sidebar.collapsed.includes(section) ? 'right' : 'down'} size={12} />
              <span>{titles[section]}</span>
            </button>
            {!sidebar.collapsed.includes(section) && (
              <div>
                {groups[section].map((item) => (
                  <button
                    key={item.path}
                    className={`location ${current === item.path ? 'selected' : ''} ${drop === item.path ? 'sidebar-drop' : ''}`}
                    title={item.path}
                    draggable
                    onDragStart={(event) => drag(event, section, item.path)}
                    onDragEnd={() => setDrop('')}
                    onContextMenu={(event) =>
                      context(section, event, {
                        ...item,
                        name: sidebar.labels[item.path] || item.name,
                      })
                    }
                    onDragOver={(event) => {
                      if (
                        !event.dataTransfer.types.includes(SIDEBAR_DRAG) &&
                        !(
                          section === 'favorites' &&
                          event.dataTransfer.types.includes(SHORTCUT_DRAG)
                        )
                      )
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDrop(item.path);
                    }}
                    onDrop={(event) => {
                      void finishDrop(event, section, item.path).catch(report);
                    }}
                    onClick={(event) => {
                      if (event.altKey)
                        void window.viewer
                          .stat(item.path)
                          .then((entry) => workspace.open(entry))
                          .catch(report);
                      else void workspace.openPath(item.path).catch(report);
                    }}
                  >
                    <Icon
                      name={
                        section === 'recents'
                          ? 'clock'
                          : section === 'favorites'
                            ? 'star'
                            : item.path === bootstrap.home
                              ? 'home'
                              : item.name === 'Volumes' || item.name === 'Computer'
                                ? 'disk'
                                : 'folder'
                      }
                      size={16}
                    />
                    <span>{sidebar.labels[item.path] || item.name}</span>
                  </button>
                ))}
                {section === 'favorites' && !saved.favorites.length && (
                  <p className="sidebar-hint">Drag a folder here.</p>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Sidebar width"
        aria-orientation="vertical"
        aria-valuenow={sidebar.width}
        aria-valuemin={160}
        aria-valuemax={360}
        tabIndex={0}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const width =
            event.key === 'Home'
              ? 160
              : event.key === 'End'
                ? 360
                : sidebar.width + (event.key === 'ArrowRight' ? 10 : -10);
          changePreferences((ui) => ({ ...ui, sidebar: { ...ui.sidebar, width } }));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          resizing.current = { x: event.clientX, width: getState().saved.ui.sidebar.width };
        }}
        onPointerMove={(event) => {
          if (resizing.current)
            changePreferences((ui) => ({
              ...ui,
              sidebar: {
                ...ui.sidebar,
                width: resizing.current!.width + event.clientX - resizing.current!.x,
              },
            }));
        }}
        onPointerUp={() => {
          resizing.current = null;
        }}
        onPointerCancel={() => {
          resizing.current = null;
        }}
      />
      {menu && (
        <ContextMenu
          position={menu}
          request={menu.request}
          label="Sidebar actions"
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
