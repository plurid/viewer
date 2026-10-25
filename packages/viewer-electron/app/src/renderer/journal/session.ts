import type { ViewerAPI } from '../../domain/contracts';
import {
  journalFilterSchema,
  type JournalFilter,
  type JournalPage,
  type JournalRecord,
} from '../../domain/journal/events';
import { errorMessage } from '../../domain/errors';

export interface JournalSnapshot {
  filter: JournalFilter;
  page?: JournalPage;
  loading: boolean;
  following: boolean;
  unseen: number;
  error?: string;
}

/** One reader's cursor. Stale IPC replies cannot replace a newer filter or a paused snapshot. */
export class JournalSession {
  private state: JournalSnapshot;
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private loading = false;
  private pending = false;
  private connected = false;
  private unsubscribe?: () => void;

  constructor(
    private readonly api: Pick<ViewerAPI, 'journalQuery' | 'onEvent'>,
    filter: JournalFilter,
  ) {
    this.state = {
      filter: journalFilterSchema.parse(filter),
      loading: false,
      following: true,
      unseen: 0,
    };
  }

  snapshot = (): JournalSnapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<JournalSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  connect(): () => void {
    this.connected = true;
    this.unsubscribe = this.api.onEvent((event) => {
      if (event.type === 'journal-changed') void this.refresh();
    });
    void this.refresh();
    return () => {
      this.connected = false;
      this.revision += 1;
      this.unsubscribe?.();
    };
  }

  setFilter(filter: JournalFilter): void {
    const valid = journalFilterSchema.safeParse(filter);
    if (!valid.success) {
      this.update({ error: 'Check the filters and time range. The previous results are kept.' });
      return;
    }
    this.revision += 1;
    this.update({ filter: valid.data, following: true, unseen: 0, error: undefined });
    void this.refresh();
  }

  pause(): void {
    if (!this.state.following) return;
    this.revision += 1;
    this.update({ following: false });
  }

  follow(): void {
    this.revision += 1;
    this.update({ following: true, unseen: 0 });
    void this.refresh();
  }

  async refresh(older = false): Promise<void> {
    if (this.loading) {
      this.pending = true;
      return;
    }
    this.loading = true;
    const revision = this.revision;
    const { filter, page: previous, following } = this.state;
    this.update({ loading: true });
    try {
      const page = await this.api.journalQuery({
        filter,
        limit: 200,
        ...(older && previous ? { through: previous.through, before: previous.nextBefore } : {}),
      });
      if (!this.connected || revision !== this.revision) return;
      const sameGeneration = previous?.status.generation === page.status.generation;
      if (!following && previous && sameGeneration && !older) {
        this.update({
          unseen: Math.max(0, page.matched - previous.matched),
          page: { ...previous, status: page.status },
          error: undefined,
        });
      } else {
        const records: JournalRecord[] =
          older && previous && sameGeneration
            ? [
                ...previous.records,
                ...page.records.filter(
                  (record) => !previous.records.some((older) => older.id === record.id),
                ),
              ]
            : page.records;
        this.update({ page: { ...page, records }, unseen: 0, error: undefined });
      }
    } catch (error) {
      if (this.connected && revision === this.revision) this.update({ error: errorMessage(error) });
    } finally {
      this.loading = false;
      if (this.connected) this.update({ loading: false });
      if (this.pending && this.connected) {
        this.pending = false;
        void this.refresh();
      }
    }
  }

  async older(): Promise<void> {
    if (!this.state.page?.nextBefore || this.loading) return;
    this.pause();
    await this.refresh(true);
  }
}
