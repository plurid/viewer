/**
 * EACH MENU GROUP HAS ITS OWN ICON (2026-10-23): Lens, Text, Workspace and Preview fell back to the
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
  'Size & position',
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
