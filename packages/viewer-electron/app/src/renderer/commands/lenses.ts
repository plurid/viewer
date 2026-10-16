import {
  lensGroupTree,
  type LensDocument,
  type LensFolder,
  type LensGroup,
  type LensOp,
  type ResolvedLens,
} from '../../domain/lenses';
import { parentPath } from '../../domain/planes';
import { createLens, editLens, setCollapsedGroups, shareLens } from '../state/lenses';
import { updateFolderPresentation } from '../state/store';
import type { LensPrompt } from '../explorer/LensDialogs';
import type { CommandContext, CommandDefinition } from './registry';

export interface LensCommandActions {
  folder(): string;
  data(): LensFolder | null;
  /** The lens the folder is grouped by, or the one its Map shows. */
  document(): LensDocument | undefined;
  resolved(): ResolvedLens | undefined;
  prompt(prompt: LensPrompt): void;
  /** Selects the items of a group (null: Unsorted). */
  selectGroup(group: string | null): void;
}
/** Commands a lens group heading's menu offers. */
export const lensGroupMenuIDs = [
  'lens.select-group',
  'lens.rename-group',
  'lens.edit-rules',
  'lens.new-subgroup',
  'lens.collapse-all',
  'lens.expand-all',
  'lens.delete-group',
];
/** The lens picker in a folder plane's header. */
export function lensMenuIDs(data: LensFolder | null): string[] {
  return [
    ...(data?.lenses ?? []).map((document) => 'group.lens.' + document.lens.id),
    'lens.new',
    'lens.new-group',
    'lens.rename',
    'lens.duplicate',
    'lens.make-shared',
    'lens.clean-missing',
    'lens.collapse-all',
    'lens.expand-all',
    'lens.reveal-file',
    'lens.delete',
  ];
}

const plain = (context: CommandContext) =>
  !!context.folder && ['folder', 'files', 'window'].includes(context.scope) && !context.lensGroup;
/** Lens editing commands for one folder plane. None of them move, rename or remove files. */
export function lensCommands(actions: LensCommandActions): CommandDefinition[] {
  const editable = () => {
    const document = actions.document();
    return document?.writable ? document : undefined;
  };
  const children = (context: CommandContext) =>
    context.selection.filter((entry) => parentPath(entry.path) === actions.folder());
  const group = (context: CommandContext): LensGroup | undefined =>
    context.lensGroup?.id
      ? actions.document()?.lens.groups.find((item) => item.id === context.lensGroup!.id)
      : undefined;
  const lensGroups = () => actions.document()?.lens.groups ?? [];
  const commands: CommandDefinition[] = [
    ...(actions.data()?.lenses ?? []).map((document): CommandDefinition => ({
      id: 'group.lens.' + document.lens.id,
      label: `Group by “${document.lens.name}”`,
      group: 'View',
      icon: 'lens',
      aliases: ['lens', document.lens.name],
      detail: document.local ? 'Lens kept on this Mac' : 'Lens',
      when: (context) => !!context.folder && !context.lensGroup,
      run: () =>
        updateFolderPresentation(actions.folder(), { group: 'lens', lens: document.lens.id }),
    })),
    {
      id: 'lens.new',
      label: 'New lens…',
      group: 'Lens',
      icon: 'lens',
      aliases: ['lens', 'label', 'organize', 'groups', 'virtual folders'],
      detail: 'Group this folder’s items without moving them',
      when: plain,
      run: () => actions.prompt({ kind: 'new-lens', folder: actions.folder() }),
    },
    {
      id: 'lens.group-selection',
      label: 'Group selection…',
      group: 'Lens',
      icon: 'lens',
      aliases: ['lens group', 'label', 'organize'],
      detail: 'Puts the items in a lens group; they stay where they are on disk',
      when: (context) =>
        plain(context) && children(context).length > 0 && (!actions.document() || !!editable()),
      run: (context) =>
        actions.prompt({
          kind: 'new-group',
          folder: actions.folder(),
          document: actions.document(),
          names: children(context).map((entry) => entry.name),
        }),
    },
    {
      id: 'lens.move-to-group',
      label: 'Move to group…',
      group: 'Lens',
      icon: 'lens',
      aliases: ['lens', 'assign', 'label'],
      when: (context) => plain(context) && !!editable() && children(context).length > 0,
      run: (context) =>
        actions.prompt({
          kind: 'move',
          folder: actions.folder(),
          document: editable()!,
          names: children(context).map((entry) => entry.name),
        }),
    },
    {
      id: 'lens.move-to-unsorted',
      label: 'Move to Unsorted',
      group: 'Lens',
      icon: 'lens',
      when: (context) =>
        plain(context) &&
        !!editable() &&
        children(context).some(
          (entry) => actions.resolved()?.placements.get(entry.path)?.group !== null,
        ),
      run: (context) =>
        editLens(
          actions.folder(),
          editable()!.file,
          children(context).map((entry): LensOp => ({
            kind: 'place',
            name: entry.name,
            group: null,
          })),
          'Move to Unsorted',
        ),
    },
    {
      id: 'lens.place-automatically',
      label: 'Place automatically',
      group: 'Lens',
      icon: 'lens',
      aliases: ['reset place', 'rules'],
      detail: 'Lets the lens rules and layout decide again',
      when: (context) =>
        plain(context) &&
        !!editable() &&
        children(context).some((entry) => actions.resolved()?.placements.get(entry.path)?.manual),
      run: (context) =>
        editLens(
          actions.folder(),
          editable()!.file,
          children(context).map((entry): LensOp => ({ kind: 'forget', name: entry.name })),
          'Place automatically',
        ),
    },
    {
      id: 'lens.new-group',
      label: 'New group…',
      group: 'Lens',
      icon: 'plus',
      when: (context) => plain(context) && !!editable() && !context.selection.length,
      run: () =>
        actions.prompt({ kind: 'new-group', folder: actions.folder(), document: editable()! }),
    },
    {
      id: 'lens.rename',
      label: 'Rename lens…',
      group: 'Lens',
      icon: 'rename',
      when: (context) => plain(context) && !!editable(),
      run: () =>
        actions.prompt({ kind: 'rename-lens', folder: actions.folder(), document: editable()! }),
    },
    {
      id: 'lens.duplicate',
      label: 'Duplicate lens',
      group: 'Lens',
      icon: 'copy',
      when: (context) => plain(context) && !!actions.document(),
      run: async () => {
        const { lens } = actions.document()!;
        const ops: LensOp[] = [
          ...lensGroupTree(lens).map(({ group }): LensOp => ({ kind: 'set-group', group })),
          ...lens.members.map((member): LensOp => ({
            kind: 'place',
            name: member.name,
            group: member.group ?? null,
            ...(member.at ? { at: member.at } : {}),
          })),
        ];
        const created = await createLens(
          actions.folder(),
          lens.name + ' copy',
          ops,
          'Duplicate lens',
        );
        updateFolderPresentation(actions.folder(), { group: 'lens', lens: created.lens.id });
      },
    },
    {
      id: 'lens.make-shared',
      label: 'Store lens in this folder',
      group: 'Lens',
      icon: 'share',
      detail: 'Moves it from this Mac into .viewer, so it travels with the folder',
      when: (context) => plain(context) && !!actions.document()?.local && !!actions.data()?.shared,
      run: () => shareLens(actions.folder(), actions.document()!.file),
    },
    {
      id: 'lens.clean-missing',
      label: () => {
        const count = actions.resolved()?.missing.length ?? 0;
        return `Clean up ${count.toLocaleString()} missing ${count === 1 ? 'item' : 'items'}`;
      },
      group: 'Lens',
      icon: 'refresh',
      detail: 'Forgets groups and places of items no longer in this folder',
      when: (context) => plain(context) && !!editable() && !!actions.resolved()?.missing.length,
      run: () =>
        editLens(
          actions.folder(),
          editable()!.file,
          actions.resolved()!.missing.map((name): LensOp => ({ kind: 'forget', name })),
          'Clean up missing items',
        ),
    },
    {
      id: 'lens.collapse-all',
      label: 'Collapse all groups',
      group: 'Lens',
      icon: 'up',
      when: (context) => !!context.folder && lensGroups().length > 0,
      run: () =>
        setCollapsedGroups(
          actions.folder(),
          actions.document()!.lens.id,
          lensGroups().map((item) => item.id),
        ),
    },
    {
      id: 'lens.expand-all',
      label: 'Expand all groups',
      group: 'Lens',
      icon: 'down',
      when: (context) =>
        !!context.folder &&
        !!actions.document() &&
        !!actions.data()?.collapsed[actions.document()!.lens.id]?.length,
      run: () => setCollapsedGroups(actions.folder(), actions.document()!.lens.id, []),
    },
    {
      id: 'lens.reveal-file',
      label: 'Show lens file',
      group: 'Lens',
      icon: 'external',
      when: (context) => plain(context) && !!actions.document() && !actions.document()!.local,
      run: () => window.viewer.reveal(actions.document()!.file),
    },
    {
      id: 'lens.delete',
      label: 'Move lens to Trash…',
      group: 'Lens',
      icon: 'trash',
      detail: 'Your files stay where they are',
      when: (context) => plain(context) && !!actions.document(),
      run: () =>
        actions.prompt({
          kind: 'trash-lens',
          folder: actions.folder(),
          document: actions.document()!,
        }),
    },
    {
      id: 'lens.select-group',
      label: 'Select items in group',
      group: 'Lens',
      icon: 'check',
      when: (context) => !!context.lensGroup,
      run: (context) => actions.selectGroup(context.lensGroup!.id),
    },
    {
      id: 'lens.rename-group',
      label: 'Rename group…',
      group: 'Lens',
      icon: 'rename',
      when: (context) => !!group(context) && !!editable(),
      run: (context) =>
        actions.prompt({
          kind: 'rename-group',
          folder: actions.folder(),
          document: editable()!,
          group: group(context)!,
        }),
    },
    {
      id: 'lens.edit-rules',
      label: 'Rules…',
      group: 'Lens',
      icon: 'settings',
      detail: 'Fill this group automatically by name, type or date',
      when: (context) => !!group(context) && !!editable(),
      run: (context) =>
        actions.prompt({
          kind: 'rules',
          folder: actions.folder(),
          document: editable()!,
          group: group(context)!,
        }),
    },
    {
      id: 'lens.new-subgroup',
      label: 'New group inside…',
      group: 'Lens',
      icon: 'plus',
      when: (context) => !!group(context) && !!editable(),
      run: (context) =>
        actions.prompt({
          kind: 'new-group',
          folder: actions.folder(),
          document: editable()!,
          parent: group(context)!.id,
        }),
    },
    {
      id: 'lens.delete-group',
      label: 'Delete group',
      group: 'Lens',
      icon: 'close',
      detail: 'Its items return to the parent group or Unsorted; files are not touched',
      when: (context) => !!group(context) && !!editable(),
      run: (context) => {
        const target = group(context)!;
        editLens(
          actions.folder(),
          editable()!.file,
          [{ kind: 'delete-group', id: target.id }],
          `Delete group “${target.name}”`,
        );
      },
    },
  ];
  return commands;
}
