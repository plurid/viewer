/** Runs one true-shape search and posts every better layout. The panel ends a search by closing
 * this worker. */
import { nestSearch } from '../../../domain/layout/nesting/search';
import { errorMessage } from '../../../domain/errors';
import type { NestReply, NestRequest } from './protocol';

const post = (reply: NestReply) => self.postMessage(reply);
/** Gives the event loop a turn between passes. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

self.onmessage = async (event: MessageEvent<NestRequest>) => {
  const request = event.data;
  try {
    for (const update of nestSearch(request.problem, {
      budget: request.budget,
      now: () => performance.now(),
      seed: request.seed,
      looser: request.looser,
    })) {
      post({ kind: 'update', update });
      await pause();
    }
  } catch (error) {
    post({ kind: 'error', error: errorMessage(error) });
  }
};
