/**
 * The true-shape search in a worker, restarted shortly after the problem settles. Better layouts
 * arrive while it runs; Stop or a new problem closes the worker, which ends the search at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NestProblem } from '../../../domain/layout/nesting/nest';
import { better, type NestUpdate } from '../../../domain/layout/nesting/search';
import type { NestReply, NestRequest } from './protocol';
import { nestingWorkers } from './workers';

export type SearchStatus = 'idle' | 'waiting' | 'searching' | 'done' | 'stopped' | 'failed';
export interface NestSearchState {
  status: SearchStatus;
  update?: NestUpdate;
  error?: string;
}
interface State extends NestSearchState {
  /** The problem `update` belongs to. */
  problem?: NestProblem;
}
/** Quantities typed in a row start one search, not one each. */
const settle = 500;

export function useNestSearch(
  problem: NestProblem | undefined,
  looser: NestProblem | undefined,
  budget: number,
) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const worker = useRef<Worker | null>(null);
  const [round, setRound] = useState(0);
  const [extra, setExtra] = useState(0);
  /** The problem the shown layout belongs to, and that layout: a longer search keeps it until
   * it finds a better one. */
  const shown = useRef<{ problem?: NestProblem; update?: NestUpdate }>({});
  const close = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => {
    close();
    if (!problem) {
      shown.current = {};
      setState({ status: 'idle' });
      return;
    }
    const kept = shown.current.problem === problem ? shown.current.update : undefined;
    shown.current = { problem, update: kept };
    setState({ status: 'waiting', update: kept, problem });
    const priced = problem.formats.some((format) => format.price > 0);
    const timer = setTimeout(() => {
      const started = nestingWorkers.nest();
      worker.current = started;
      setState((current) => ({ ...current, status: 'searching' }));
      started.onmessage = (event: MessageEvent<NestReply>) => {
        if (worker.current !== started) return;
        const reply = event.data;
        if (reply.kind === 'error') {
          setState((current) => ({ ...current, status: 'failed', error: reply.error }));
          close();
          return;
        }
        const previous = shown.current.update;
        const update =
          previous?.best && reply.update.best && !better(reply.update.best, previous.best, priced)
            ? { ...reply.update, best: previous.best }
            : reply.update;
        shown.current = { problem, update };
        setState({ status: update.done ? 'done' : 'searching', update, problem });
        if (update.done) close();
      };
      started.onerror = (event) => {
        event.preventDefault();
        if (worker.current !== started) return;
        setState((current) => ({
          ...current,
          status: 'failed',
          error: 'Nesting stopped unexpectedly.',
        }));
        close();
      };
      started.postMessage({
        problem,
        looser,
        budget: budget + extra,
        seed: round + 1,
      } satisfies NestRequest);
    }, settle);
    return () => {
      clearTimeout(timer);
      close();
    };
  }, [problem, looser, budget, extra, round, close]);
  const stop = useCallback(() => {
    if (!worker.current) return;
    close();
    setState((current) => ({ ...current, status: 'stopped' }));
  }, [close]);
  /** Searches again with more time, from a different random start. */
  const longer = useCallback(() => {
    setExtra((value) => value + budget);
    setRound((value) => value + 1);
  }, [budget]);
  // Until the effect above catches up with a new problem, the last layout is of the old one: its
  // sheets may name formats that are gone, so it is not shown.
  const { problem: owner, ...shownState } = state;
  return owner === problem
    ? { ...shownState, stop, longer }
    : { status: problem ? ('waiting' as const) : ('idle' as const), stop, longer };
}
