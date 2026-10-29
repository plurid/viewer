import { basketEntries, addToBasket, saveCollection } from '../../state/store';
import { sourceVersion } from '../../../domain/files/inspection';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';
import { sendWindowEvent } from '../../app/window-events';

/** File tools, inspection dialogs and action tasks. */
export function toolsCommands({
  actions,
  state,
  space,
  windowScope,
  paneScope,
}: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [
    {
      id: 'personal-backup',
      label: 'Backup and restore…',
      group: 'Workspace',
      icon: 'file',
      aliases: ['portable', 'backup', 'restore', 'move computer'],
      detail: 'Workspaces, notes, unsaved text and personal preferences.',
      when: () => !!actions.backup,
      run: () => actions.backup?.(),
    },
    {
      id: 'capabilities',
      label: 'What can I do here?',
      group: 'Help',
      icon: 'info',
      aliases: ['help', 'discover', 'pin', 'customize toolbar', 'available actions'],
      detail: 'Find actions, shortcuts and pinned tools for the current selection.',
      when: () => !!actions.capabilities,
      run: (context) => actions.capabilities?.(context),
    },
    {
      id: 'related-files',
      label: 'Related files…',
      group: 'Files',
      icon: 'link',
      aliases: ['provenance', 'dependencies', 'source links', 'relationships'],
      when: (context) => context.selection.length > 0 || !!context.path,
      run: (context) => {
        const paths = context.selection.length
          ? context.selection.map((file) => file.path)
          : context.path
            ? [context.path]
            : [];
        sendWindowEvent('viewer:relationships', { paths, paneID: context.paneID });
      },
    },
    {
      id: 'workflows',
      label: 'Workflows…',
      group: 'Workspace',
      icon: 'file',
      aliases: ['pipeline', 'run workflow', 'workflow file'],
      when: (context) => !['workspace', 'sidebar'].includes(context.scope),
      run: (context) => {
        const [only] = context.selection;
        const file =
          context.selection.length === 1 && only && /(?:^|\.)workflow\.jsonc$/.test(only.name)
            ? only.path
            : undefined;
        sendWindowEvent('viewer:workflows', { context, file });
      },
    },
    {
      id: 'add-to-basket',
      label: 'Add to basket',
      group: 'Files',
      icon: 'check',
      aliases: ['collect', 'basket', 'keep selection'],
      when: (context) => context.selection.length > 0,
      run: (context) => {
        basketEntries(context.selection);
      },
    },
    {
      id: 'collections',
      label: 'Collections and basket…',
      group: 'Workspace',
      icon: 'folder',
      aliases: ['collection', 'basket', 'virtual folder'],
      when: windowScope,
      run: () => {
        sendWindowEvent('viewer:collections');
      },
    },
    {
      id: 'basket-all-query',
      label: 'Add all indexed matches to basket',
      group: 'Files',
      icon: 'search',
      aliases: ['all results', 'snapshot selection'],
      when: (context) =>
        !!space.panes.find((pane) => pane.id === context.paneID && pane.type === 'search'),
      run: async (context) => {
        const pane = space.panes.find((pane) => pane.id === context.paneID);
        if (pane?.type !== 'search') return;
        const snapshot = await window.viewer.querySnapshot({
          query: pane.query,
          root: pane.allLocations ? undefined : pane.path,
          content: pane.content ?? false,
          recursive: pane.recursive ?? true,
        });
        addToBasket(
          snapshot.entries.map((entry) => ({ path: entry.path, version: sourceVersion(entry) })),
        );
      },
    },
    {
      id: 'save-smart-folder',
      label: 'Save as smart folder',
      group: 'Files',
      icon: 'search',
      aliases: ['smart folder', 'live collection', 'saved search folder'],
      when: (context) =>
        actions.ready &&
        !!space.panes.find((pane) => pane.id === context.paneID && pane.type === 'search'),
      run: (context) => {
        const pane = space.panes.find((pane) => pane.id === context.paneID);
        if (pane?.type !== 'search') return;
        const sources = pane.allLocations ? state.settings.settings.search.roots : [pane.path];
        if (!sources.length) throw new Error('Add an indexed location in Settings → Search first.');
        const id = crypto.randomUUID();
        // A query collection follows the index, so it stays current like a Finder smart folder.
        saveCollection({
          id,
          name: (pane.name || pane.query).slice(0, 100),
          kind: 'query',
          sources,
          query: pane.query,
          content: pane.content ?? false,
          recursive: pane.recursive ?? true,
        });
        actions.workspace.openCollection(id);
      },
    },
    {
      id: 'find-duplicates',
      label: 'Find duplicates…',
      group: 'Files',
      icon: 'copy',
      aliases: ['duplicates', 'identical files', 'reclaim space'],
      when: (context) =>
        !['workspace', 'sidebar'].includes(context.scope) &&
        (!!context.directory || context.selection.some((file) => file.directory)),
      run: (context) => {
        const folders = context.selection.filter((file) => file.directory).map((file) => file.path);
        sendWindowEvent(
          'viewer:duplicates',
          folders.length ? folders : context.directory ? [context.directory] : [],
        );
      },
    },
    {
      id: 'compare-locations',
      label: 'Compare locations…',
      group: 'Files',
      icon: 'columns',
      aliases: ['compare folders', 'diff', 'reconcile'],
      when: (context) => !['workspace', 'sidebar'].includes(context.scope),
      run: (context) => {
        sendWindowEvent(
          'viewer:compare',
          context.selection.length === 2
            ? context.selection.map((file) => file.path)
            : context.directory
              ? [context.directory]
              : [],
        );
      },
    },
    {
      id: 'checkpoints',
      label: 'Content checkpoints…',
      group: 'App',
      icon: 'file',
      aliases: ['recovery', 'snapshots', 'restore checkpoint'],
      when: windowScope,
      run: () => {
        sendWindowEvent('viewer:checkpoints');
      },
    },
    {
      id: 'inspect-file',
      label: 'Inspect file…',
      group: 'Files',
      icon: 'file',
      aliases: ['facts', 'document metadata', 'pages', 'dimensions'],
      when: (context) =>
        context.selection.length === 1 || (context.scope === 'preview' && !!context.path),
      run: (context) => {
        const path = context.selection[0]?.path || context.path;
        if (path) sendWindowEvent('viewer:inspect', path);
      },
    },
    {
      id: 'plane-notes',
      label: 'Plane notes…',
      group: 'Plane',
      icon: 'file',
      aliases: ['annotate', 'notes'],
      when: paneScope,
      run: (context) => {
        if (context.paneID) sendWindowEvent('viewer:notes', context.paneID);
      },
    },
  ];
  commands.push({
    id: 'tasks',
    label: 'Action tasks…',
    group: 'Actions',
    icon: 'command',
    aliases: ['history', 'proposals'],
    when: windowScope,
    run: () => {
      sendWindowEvent('viewer:tasks');
    },
  });
  return commands;
}
