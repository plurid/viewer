import { useRef, useState, type DragEvent } from 'react';
import type { SidebarSection } from '../../../domain/contracts';
import { trashLocation } from '../../../domain/files/trash';
import { reorder } from '../../../domain/preferences/ui';
import {
  activeWorkspace,
  addFavorite,
  changePreferences,
  report,
  setActivePane,
  updatePane,
  useViewer,
} from '../../state/store';
import { useWorkspace } from '../../workspace/context';
import { ContextMenu } from '../ContextMenu';
import { Icon } from '../Icon';
import type { CommandRequest } from '../../commands/registry';
import { measureLocalX, type Point } from '../projectedResize';
import { baseName } from '../../../domain/workspaces/planes';
import { effectiveWindowUI } from '../../state/effective-ui';

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
export function Sidebar({ paneID }: { paneID?: string }) {
  const saved = useViewer((state) => state.saved);
  const bootstrap = useViewer((state) => state.bootstrap);
  const space = useViewer(activeWorkspace);
  const active = useViewer((state) => state.activePane);
  const workspace = useWorkspace();
  const sidebar = useViewer(effectiveWindowUI).sidebar;
  const owner = space.panes.find((pane) => pane.id === (paneID || active));
  const layout = paneID
    ? owner?.type === 'folder'
      ? (owner.sidebar ?? { visible: true, width: 210 })
      : { visible: false, width: 210 }
    : sidebar;
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest } | null>(null);
  const [drop, setDrop] = useState('');
  const element = useRef<HTMLElement>(null);
  const resizing = useRef<{
    x: number;
    width: number;
    latest?: number;
    localX: (point: Point) => number | undefined;
  } | null>(null);
  const current = owner?.path;
  const target = { paneID, workspaceID: space.id };
  function resize(width: number) {
    width = Math.max(160, Math.min(360, Math.round(width)));
    if (paneID) {
      if (activeWorkspace().id === space.id)
        updatePane(paneID, { sidebar: { visible: layout.visible, width } });
    } else changePreferences((ui) => ({ ...ui, sidebar: { ...ui.sidebar, width } }));
  }
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
    recents: saved.recents.slice(0, 8).map((path) => ({ path, name: baseName(path) })),
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
        context: { ...target, sidebar: { section, ...item }, selection: [] },
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
      if (event.dataTransfer.types.includes('Files')) {
        const paths = await window.viewer.fileDropPaths(Array.from(event.dataTransfer.files));
        for (const path of paths) {
          const entry = await window.viewer.stat(path);
          if (entry.directory) addFavorite(entry.path, entry.name, before);
        }
        return;
      }
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
  if (!layout.visible) return null;
  return (
    <aside
      className="location-sidebar"
      ref={element}
      aria-label={paneID ? 'Plane navigation' : 'Locations'}
      style={{ width: paneID ? `min(${layout.width}px, 50%)` : layout.width }}
      onFocus={() => {
        if (paneID) setActivePane(paneID);
      }}
      onPointerDown={() => {
        if (paneID) setActivePane(paneID);
      }}
    >
      <div className="sidebar-scroll">
        {sidebar.order.map((section) => (
          <section
            key={section}
            aria-label={titles[section]}
            className={`sidebar-group ${drop === section ? 'sidebar-drop' : ''}`}
            onDragOver={(event) => {
              const supported =
                event.dataTransfer.types.includes(SIDEBAR_DRAG) ||
                (section === 'favorites' &&
                  (event.dataTransfer.types.includes(SHORTCUT_DRAG) ||
                    event.dataTransfer.types.includes('Files')));
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
                    draggable={item.path !== trashLocation}
                    onDragStart={(event) => drag(event, section, item.path)}
                    onDragEnd={() => setDrop('')}
                    onContextMenu={(event) => {
                      if (item.path === trashLocation) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                      }
                      context(section, event, {
                        ...item,
                        name: sidebar.labels[item.path] || item.name,
                      });
                    }}
                    onDragOver={(event) => {
                      if (
                        !event.dataTransfer.types.includes(SIDEBAR_DRAG) &&
                        !(
                          section === 'favorites' &&
                          (event.dataTransfer.types.includes(SHORTCUT_DRAG) ||
                            event.dataTransfer.types.includes('Files'))
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
                      if (item.path === trashLocation) {
                        window.dispatchEvent(new Event('viewer:trash'));
                        return;
                      }
                      if (item.path === '/Volumes' && bootstrap.platform === 'darwin') {
                        window.dispatchEvent(new Event('viewer:volumes'));
                        return;
                      }
                      void workspace
                        .openPath(item.path, { ...target, linked: event.altKey, directory: true })
                        .catch(report);
                    }}
                  >
                    <Icon
                      name={
                        item.path === trashLocation
                          ? 'trash'
                          : item.name === 'Applications'
                            ? 'grid'
                            : section === 'recents'
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
        aria-valuenow={layout.width}
        aria-valuemin={160}
        aria-valuemax={360}
        tabIndex={0}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const width =
            event.key === 'Home'
              ? 160
              : event.key === 'End'
                ? 360
                : layout.width + (event.key === 'ArrowRight' ? 10 : -10);
          resize(width);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !element.current) return;
          event.preventDefault();
          event.stopPropagation();
          if (paneID) setActivePane(paneID);
          event.currentTarget.focus({ preventScroll: true });
          const localX = paneID ? measureLocalX(element.current) : (point: Point) => point.x;
          const x = localX({ x: event.clientX, y: event.clientY });
          if (x === undefined) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          resizing.current = { x, width: element.current.offsetWidth, localX };
        }}
        onPointerMove={(event) => {
          const drag = resizing.current;
          if (!drag) return;
          event.stopPropagation();
          const x = drag.localX({ x: event.clientX, y: event.clientY });
          if (x !== undefined && element.current) {
            const width = Math.max(160, Math.min(360, Math.round(drag.width + x - drag.x)));
            drag.latest = width;
            element.current.style.width = paneID ? `min(${width}px, 50%)` : `${width}px`;
            event.currentTarget.setAttribute('aria-valuenow', String(width));
          }
        }}
        onPointerUp={() => {
          const width = resizing.current?.latest;
          resizing.current = null;
          if (width !== undefined) resize(width);
        }}
        onPointerCancel={() => {
          if (element.current)
            element.current.style.width = paneID
              ? `min(${layout.width}px, 50%)`
              : `${layout.width}px`;
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
