import path from 'node:path';
import type { SavedState } from '../src/domain/contracts';
import { normalizePreferences } from '../src/domain/preferences';

/** The reported topology and camera, with generated IDs and synthetic image paths only. */
export function repeatedPreviewFixture(files: string): SavedState {
  const folderID = 'reused-folder';
  const previews = ['reused-preview-1', 'reused-preview-2', 'reused-preview-3'];
  const route = (id: string) => `plurid://app/${id === folderID ? 'folders' : 'previews'}/${id}`;
  const planeID = (id: string) => `${route(id)}@0`;
  const division = () => ({ value: '', parameters: {}, query: {} });
  const node = (id: string) => ({
    sourceID: route(id),
    planeID: planeID(id),
    route: route(id),
    routeDivisions: {
      protocol: { value: '', secure: false },
      host: { value: 'originhost', controlled: true },
      path: division(),
      space: division(),
      universe: division(),
      cluster: division(),
      plane: {
        ...division(),
        value: route(id),
        parameters: { id },
        fragments: { texts: [], elements: [] },
      },
      valid: true,
    },
    width: 960,
    height: 660,
    show: true,
  });
  const camera = {
    yaw: -43.27576465709021,
    pitch: -9.532238364726346,
    roll: 0,
    scale: 0.5299709121155503,
    pivot: { x: 357.8938191315778, y: 98.56135868132961, z: -824.134932056676 },
    offset: { x: -18.566406250000114, y: -231.91796875, z: 0 },
    perspective: 2000,
  };
  const angle = (90.1 * Math.PI) / 180;
  const arrangement = {
    version: 3,
    space: {
      transform:
        'matrix3d(0.38585,0.06016,0.35828,0,0,0.52265,-0.08776,0,-0.36330,0.06390,0.38052,0,263.9308,189.6971,194.0259,1)',
      camera,
      viewSize: { width: 1440, height: 884 },
      activePlaneID: '',
      isolatePlane: '',
      lastClosedPlane: '',
      links: [],
      bookmarks: {},
      tree: [
        {
          ...node(folderID),
          location: { rotateX: 0, rotateY: 0, translateX: 0, translateY: 0, translateZ: 0 },
          children: previews.map((id, index) => {
            const reach = 100 + index * 1010;
            return {
              ...node(id),
              location: {
                translateX: 960 + reach * Math.cos(angle),
                translateY: 315,
                translateZ: -reach * Math.sin(angle),
                rotateX: 0,
                rotateY: 90.1,
              },
              parentPlaneID: planeID(folderID),
              bridgeLength: reach,
              planeAngle: 90.1,
              bridgeSide: 'start',
              bridgeOffset: -15,
              bridgeAnchor: 'edge',
              bridgeKind: index ? 'leash' : 'strip',
              linkCoordinates: { x: 960, y: 330 },
              spawnedByLinkID: `${planeID(folderID)}#/previews/${id}#api`,
            };
          }),
        },
      ],
    },
  };
  const directory = path.join(files, 'Images');
  const ui = normalizePreferences();
  ui.sidebar.visible = false;
  return {
    version: 1,
    activeWorkspace: 'reused-workspace',
    workspaces: [
      {
        id: 'reused-workspace',
        name: 'Restored workspace',
        panes: [
          {
            id: folderID,
            type: 'folder',
            path: directory,
            mode: 'list',
            sort: 'name',
            descending: false,
            showHidden: false,
            history: [directory],
            historyIndex: 0,
          },
          ...previews.map((id) => ({
            id,
            type: 'preview' as const,
            path: path.join(directory, 'Color.png'),
          })),
        ],
        roots: [folderID],
        activePane: previews[2],
        arrangement: { 'pluridState-viewer-reused-workspace': JSON.stringify(arrangement) },
      },
    ],
    favorites: [],
    recents: [],
    look: 'dark',
    ui,
  };
}
