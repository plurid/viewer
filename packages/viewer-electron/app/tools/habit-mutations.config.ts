import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';

/** Transform copies in memory so regression probes never overwrite the shared working tree. */
const probes: Record<string, { file: string; before: string; after: string }> = {
  commandFolder: {
    file: '/src/renderer/commands/folders.ts',
    before: 'rows: parent.length ? rows.filter((row) => scoped.includes(row)) : rows,',
    after: 'rows,',
  },
  resultOrder: {
    file: '/src/renderer/commands/CommandResults.tsx',
    before: 'const rows = ids.map((id) => current.get(id)!);',
    after: 'const rows = [...incoming];',
  },
  defaultActive: {
    file: '/src/renderer/commands/CommandResults.tsx',
    before: 'const input = useRef<HTMLInputElement>(null);',
    after:
      'useEffect(() => { if (rows[0] && !rows.some((row) => row.id === activeID)) setActiveID(rows[0].id); }, [rows, activeID]);\n  const input = useRef<HTMLInputElement>(null);',
  },
  pendingReturn: {
    file: '/src/renderer/explorer/GoToFolderDialog.tsx',
    before: 'void open(paths[0]);',
    after: 'void open();',
  },
  storeDeferred: {
    file: '/src/desktop/windows/folder-history-checks.ts',
    before: 'unchecked: true',
    after: 'unavailable: true',
  },
  nativeCase: {
    file: '/src/desktop/files/folder-history.ts',
    before: 'realpathSync.native(path)',
    after: 'realpathSync(path)',
  },
  resolution: {
    file: '/src/desktop/files/folder-history.ts',
    before: 'path: realpathSync.native(path)',
    after: 'path',
  },
  sessionAnchor: {
    file: '/src/desktop/windows/workspace-sessions.ts',
    before: 'if (session && this.historyChanges.needsRefresh(revision))',
    after: 'if (false && session && this.historyChanges.needsRefresh(revision))',
  },
  mainClear: {
    file: '/src/desktop/bridge.ts',
    before: 'this.folderChecks.clear(forgotten);',
    after: 'void forgotten;',
  },
  stat: {
    file: '/src/desktop/ipc/file-handlers.ts',
    before: 'return entry(file);',
    after: "return entry(await (await import('node:fs/promises')).realpath(file));",
  },
  columns: {
    file: '/src/renderer/explorer/column-navigation.ts',
    before: '      setDirectory(directory);',
    after: '      rememberFolderVisit(directory);\n      setDirectory(directory);',
  },
  hookPool: {
    file: '/src/renderer/explorer/useFolderSuggestions.ts',
    before: 'pool: metadataChecks,',
    after: 'pool: new FolderCheckPool(),',
  },
  equalReply: {
    file: '/src/renderer/state/folder-visits.ts',
    before: 'return sameFolderVisits(result, current) ? current : result;',
    after: 'return result;',
  },
  equalHook: {
    file: '/src/renderer/explorer/useFolderSuggestions.ts',
    before: '[signature, query, jump]',
    after: '[signature, query, jump, visits]',
  },
  slow: {
    file: '/src/domain/files/folder-checks.ts',
    before: 'task.abandoned = true;',
    after: 'task.abandoned = false;',
  },
  case: {
    file: '/src/renderer/state/places.ts',
    before: 'if (window.viewer.folderCheck)',
    after: 'if (false && window.viewer.folderCheck)',
  },
  dangling: {
    file: '/src/desktop/files/folder-history.ts',
    before: 'return { directory: false, unavailable: true };',
    after: 'return { directory: false };',
  },
};
const name = process.env.VIEWER_HABIT_MUTATION;
const probe = name ? probes[name] : undefined;
if (name && !probe) throw new Error('Choose a known folder-history mutation.');
export default defineConfig({
  ...base,
  plugins: [
    ...(base.plugins ?? []),
    {
      name: 'habit-regression-probe',
      enforce: 'pre',
      transform(code, id) {
        if (!probe || !id.endsWith(probe.file)) return;
        if (!code.includes(probe.before))
          throw new Error('The regression probe no longer matches its source.');
        const changed = code.replace(probe.before, probe.after);
        return name === 'columns'
          ? "import { rememberFolderVisit } from '../state/places';\n" + changed
          : changed;
      },
    },
  ],
  test: { ...base.test, fsModuleCache: false },
});
