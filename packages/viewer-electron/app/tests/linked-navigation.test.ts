import { expect, it } from 'vitest';
import type { TreePlane } from '@plurid/plurid-data';
import type { Workspace } from '../src/domain/contracts';
import { linkedPaneID, parentPaneID } from '../src/renderer/workspace/tree';
import { normalizePreferences } from '../src/domain/preferences';
import { preferencesSchema } from '../src/desktop/preferences-schema';
const node = (id: string, children: TreePlane[] = []) =>
  ({
    routeDivisions: { plane: { parameters: { id } }, path: { parameters: {} } },
    children,
  }) as unknown as TreePlane;
const tree = [
  node('parent', [node('folder', [node('model')]), node('image')]),
  node('other', [node('other-model')]),
];
const space = {
  panes: [
    { id: 'folder', type: 'folder', path: '/Project/Subfolder' },
    { id: 'model', type: 'preview', path: '/Project/Subfolder/Part.step' },
    { id: 'image', type: 'preview', path: '/Project/Picture.png' },
    { id: 'other-model', type: 'preview', path: '/Project/Subfolder/Part.step' },
  ],
} as Workspace;
it('returns the immediate parent and never invents one for a root or closed plane', () => {
  expect(parentPaneID(tree, 'model')).toBe('folder');
  expect(parentPaneID(tree, 'folder')).toBe('parent');
  expect(parentPaneID(tree, 'parent')).toBeUndefined();
  expect(parentPaneID(tree, 'gone')).toBeUndefined();
});
it('matches the actual direct link and distinguishes identical paths in independent roots', () => {
  const entry = { path: '/Project/Subfolder/Part.step', directory: false };
  expect(linkedPaneID(tree, space, 'folder', entry, 'darwin')).toBe('model');
  expect(linkedPaneID(tree, space, 'other', entry, 'darwin')).toBe('other-model');
  expect(linkedPaneID(tree, space, 'parent', entry, 'darwin')).toBeUndefined();
  expect(
    linkedPaneID(tree, space, 'folder', { ...entry, directory: true }, 'darwin'),
  ).toBeUndefined();
  expect(linkedPaneID([node('folder')], space, 'folder', entry, 'darwin')).toBeUndefined();
});
it('normalizes missing parent controls in old saved UI and retains an explicit hidden choice', () => {
  const ui = normalizePreferences();
  expect(ui.space.headerControls.parent).toBe(true);
  const legacy = structuredClone(ui) as unknown as {
    space: { headerControls: Record<string, boolean> };
  };
  delete legacy.space.headerControls.parent;
  expect(preferencesSchema.parse(legacy).space.headerControls.parent).toBe(true);
  expect(
    normalizePreferences({ space: { headerControls: { parent: false } } }).space.headerControls
      .parent,
  ).toBe(false);
});
