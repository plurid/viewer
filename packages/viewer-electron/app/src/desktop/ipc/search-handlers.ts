import type { FileEntry } from '../../domain/contracts';
import type { ApiHandlers } from './schemas';
import type { FileServices } from '../files/file-services';
import type { FileAccess } from '../files/file-access';
import type { Search } from '../search/search';
import { absolute, entry } from '../files/filesystem';
import { spotlightTagged } from '../search/spotlight';

type SearchHandlers = Pick<
  ApiHandlers,
  | 'indexedQuery'
  | 'querySnapshot'
  | 'indexStatus'
  | 'indexRebuild'
  | 'search'
  | 'cancelSearch'
  | 'taggedFiles'
>;
interface SearchPorts {
  files: Pick<FileServices, 'query' | 'snapshot' | 'status'>;
  search: Pick<Search, 'start' | 'cancel'>;
  fileAccess: Pick<FileAccess, 'require'>;
  rebuildIndex(): Promise<void>;
}

/** Folder and tag searches start only in granted folders; tag results are checked again. */
export function createSearchHandlers(ports: SearchPorts): SearchHandlers {
  return {
    indexedQuery: ([query]) => ports.files.query(query),
    querySnapshot: ([query]) => ports.files.snapshot(query),
    indexStatus: () => ports.files.status(),
    indexRebuild: () => ports.rebuildIndex(),
    search: async ([request]) => {
      await ports.fileAccess.require([request.root]);
      return ports.search.start(request);
    },
    cancelSearch: ([id]) => ports.search.cancel(id),
    taggedFiles: async ([tag, roots]) => {
      await ports.fileAccess.require(roots);
      const found = new Set<string>();
      for (const root of roots)
        for (const file of await spotlightTagged(absolute(root), tag)) {
          if (found.size >= 10000) break;
          found.add(file);
        }
      // Spotlight can lag behind the disk; only current, accessible items are returned.
      const entries: FileEntry[] = [];
      for (const file of found)
        try {
          await ports.fileAccess.require([file]);
          entries.push(await entry(file));
        } catch {
          // Gone, or outside granted folders.
        }
      return entries;
    },
  };
}
