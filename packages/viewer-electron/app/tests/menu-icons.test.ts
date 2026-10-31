/**
 * Each menu group has its own icon: Lens, Text, Workspace and Preview fell back to the
 * command icon, and Folder, Navigation and Project all showed a folder.
 */
import { expect, it } from 'vitest';
import {
  contextMenuSections,
  type MenuEntry,
  type MenuSection,
} from '../src/renderer/commands/menu';
import type { ResolvedCommand } from '../src/renderer/commands/registry';

const groups = [
  'Files',
  'View',
  'Folder',
  'Navigation',
  'Terminal',
  'Actions',
  'Quick actions',
  'Plane',
  'Layout',
  'Space',
  'Sidebar',
  'App',
  'Workspace',
  'Workspaces',
  'Project',
  'Lens',
  'Text',
  'Settings',
  'Preview',
];
const command = (group: string, index: number): ResolvedCommand => ({
  id: `${group}-${index}`,
  label: `${group} ${index}`,
  group,
  aliases: [],
  primary: false,
  source: 'test',
  context: { scope: 'window', workspaceID: 'w', selection: [], jobs: [], clipboard: null },
});
const submenus = (sections: MenuSection[]): Extract<MenuEntry, { kind: 'submenu' }>[] =>
  sections.flatMap((section) =>
    section.entries.flatMap((entry) => (entry.kind === 'submenu' ? [entry] : [])),
  );

it('gives every top-level group an icon of its own', () => {
  const sections = contextMenuSections(
    groups.flatMap((group) => [command(group, 1), command(group, 2)]),
    [],
  );
  const icons = new Map(submenus(sections).map((entry) => [entry.label, entry.icon]));
  for (const group of ['Folder', 'Navigation', 'Project', 'Lens', 'Text', 'Workspace', 'Preview'])
    expect(icons.has(group), group).toBe(true);
  const seen = new Map<string, string>();
  for (const [label, icon] of icons) {
    expect(icon, label).toBeTruthy();
    expect(seen.get(icon!), `${label} shares ${icon} with ${seen.get(icon!)}`).toBeUndefined();
    seen.set(icon!, label);
  }
});

it('ends with “What can I do here?” as its own row, never a Help submenu of one', () => {
  const discover = { ...command('Help', 1), id: 'capabilities', label: 'What can I do here?' };
  const sections = contextMenuSections(
    [discover, ...groups.flatMap((group) => [command(group, 1)])],
    [],
  );
  expect(submenus(sections).map((entry) => entry.label)).not.toContain('Help');
  expect(sections.at(-1)!.entries).toEqual([
    { kind: 'command', id: 'capabilities', command: discover },
  ]);
  // a scoped picker has no place for it
  expect(
    contextMenuSections([discover, command('View', 1)], [], true).flatMap((section) =>
      section.entries.map((entry) => entry.id),
    ),
  ).toContain('capabilities');
});

it('shows Fit and Frame, and the Layout menu, with icons of their own', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = (file: string) =>
    readFile(new URL('../src/renderer/' + file, import.meta.url), 'utf8');
  for (const file of [
    'previews/modules/DXFPreview.tsx',
    'previews/modules/ImagePreview.tsx',
    'previews/modules/ModelPreview.tsx',
    'explorer/map/MapView.tsx',
  ])
    expect(await source(file), file).not.toMatch(/icon="frame"/);
  const header = await source('workspace/PlaneHeader.tsx');
  expect(header).toMatch(/icon="frame" label="Frame plane"/);
  expect(header).toMatch(/icon="arrange"/);
});
