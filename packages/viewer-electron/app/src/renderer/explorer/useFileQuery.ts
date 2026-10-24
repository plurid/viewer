import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseFileQuery,
  QueryError,
  type FileQuery,
  type QueryFacts,
} from '../../domain/file-query';

const everything: FileQuery = { root: null, words: [], tags: [], needsStat: false };
/**
 * A filter's query, read (domain/file-query.ts, 2026-10-24): while one being typed does not read,
 * the last that did keeps the list, and the problem is said. Finder tags it names are looked up in
 * `folder`, through Spotlight.
 */
export function useFileQuery(
  text: string,
  folder: string,
): { query: FileQuery; facts: QueryFacts; problem?: string } {
  const last = useRef(everything);
  const read = useMemo(() => {
    try {
      return { query: parseFileQuery(text) };
    } catch (error) {
      if (error instanceof QueryError) return { problem: error.message };
      throw error;
    }
  }, [text]);
  if (read.query) last.current = read.query;
  const query = read.query ?? last.current;
  const [tagged, setTagged] = useState<{ key: string; sets: Map<string, Set<string>> }>();
  const [tagProblem, setTagProblem] = useState<string>();
  const key = `${folder}\n${query.tags.join('\n')}`;
  useEffect(() => {
    setTagProblem(undefined);
    if (!query.tags.length) return;
    let live = true;
    void Promise.all(
      query.tags.map((tag) =>
        window.viewer
          .taggedFiles(tag, [folder])
          .then((entries) => [tag, new Set(entries.map((entry) => entry.path))] as const),
      ),
    )
      .then((pairs) => {
        if (live) setTagged({ key, sets: new Map(pairs) });
      })
      .catch((error: Error) => {
        if (live) setTagProblem(error.message);
      });
    return () => {
      live = false;
    };
    // the tags and the folder, as `key` names them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const facts = useMemo<QueryFacts>(
    () => ({
      tagged: (tag) => (tagged?.key === key ? tagged.sets.get(tag) : undefined),
    }),
    [tagged, key],
  );
  return { query, facts, problem: read.problem ?? tagProblem };
}
