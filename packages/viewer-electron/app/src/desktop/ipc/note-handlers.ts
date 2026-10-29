import type { BrowserWindow } from 'electron';
import type { DesktopEvent } from '../../domain/contracts';
import type { ApiHandlers } from './schemas';
import type { Notes } from '../editing/notes';
import type { CommandReceipts } from '../actions/receipts';
import type { WindowFlushRequests } from '../windows/flush-requests';
import { sendEvent } from './events';

type NoteHandlers = Pick<ApiHandlers, 'notes' | 'receipts'>;
interface NotePorts {
  notes: Pick<Notes, 'request'>;
  receipts: Pick<CommandReceipts, 'request'>;
  flushes: Pick<WindowFlushRequests, 'request'>;
  readyWindows(): BrowserWindow[];
  isAgent(owner: number): boolean;
  emit(event: DesktopEvent): void;
}

/** Notes are private to the person. A note is trashed only after each workspace window has saved
 * and locked its open views of it. */
export function createNoteHandlers(ports: NotePorts): NoteHandlers {
  return {
    receipts: ([request]) => ports.receipts.request(request),
    notes: async ([request], owner) => {
      if (ports.isAgent(owner)) throw new Error('Notes are private to the person.');
      if (request.kind !== 'trash') return ports.notes.request(request);
      let trashed = false;
      try {
        const results = await Promise.allSettled(
          ports.readyWindows().map((window) =>
            ports.flushes.request(window.webContents.id, `note-trash:${request.id}`, (token) =>
              sendEvent(window.webContents, {
                type: 'prepare-note-trash',
                id: request.id,
                token,
              }),
            ),
          ),
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        const reply = await ports.notes.request(request);
        trashed = reply.kind === 'trashed';
        return reply;
      } finally {
        ports.emit({ type: 'note-trash-finished', id: request.id, trashed });
      }
    },
  };
}
