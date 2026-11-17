import type { ScratchPane, SearchPane, TerminalPane } from '../contracts';
import { searchName } from '../search/saved';

export function scratchPaneRecord(
  id: string,
  path: string,
  options: Pick<ScratchPane, 'bufferID' | 'title' | 'language'>,
): ScratchPane {
  return { id, type: 'scratch', path, ...options };
}

export function searchPaneRecord(
  id: string,
  home: string,
  query: string,
  name: string,
  root?: string,
  recursive = true,
  content = false,
): SearchPane {
  return {
    id,
    type: 'search',
    recursive,
    content,
    path: root || home,
    query,
    name: searchName(name),
    allLocations: !root,
  };
}

export function terminalPaneRecord(
  id: string,
  path: string,
  profileID: string,
  gitAction?: TerminalPane['gitAction'],
): TerminalPane {
  return { id, type: 'terminal', path, profileID, ...(gitAction ? { gitAction } : {}) };
}
