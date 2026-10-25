import type { ViewerAPI } from '../../domain/contracts';
import type { MediaDraft, MediaReply } from '../../domain/media/documents';
import type { MediaTransform } from '../../domain/operations/transforms';
interface Snapshot {
  draft?: MediaDraft;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  error?: string;
  unavailable?: boolean;
}
export function mediaDraft(value: MediaReply): MediaDraft {
  if (!value || !('plan' in value)) throw new Error('The media draft could not be opened.');
  return value;
}
/** Editor state outlives engine culling. Autosaves serialize against the private
 * draft revision and join Viewer's existing durable-save barrier. */
class DraftSession {
  private value: Snapshot = { loading: true, dirty: false, saving: false };
  private listeners = new Set<() => void>();
  private revision = 0;
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private off: () => void;
  constructor(
    readonly id: string,
    private api: ViewerAPI,
  ) {
    this.off = api.onEvent((event) => {
      if (
        event.type !== 'file-access' ||
        !this.value.draft?.sources.some(
          (source) =>
            source.path === event.path ||
            source.path.startsWith(event.path.replace(/\/$/, '') + '/'),
        )
      )
        return;
      this.publish({
        unavailable: true,
        error: 'File access changed. Reload this draft to check its sources.',
      });
    });
    void this.reload();
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }
  async reload() {
    try {
      const draft = mediaDraft(await this.api.media({ kind: 'get', id: this.id }));
      this.revision = draft.revision;
      this.publish({ draft, loading: false, dirty: false, error: undefined, unavailable: false });
    } catch (error) {
      this.publish({
        loading: false,
        error: String((error as Error).message || error),
        unavailable: true,
      });
    }
  }
  plan(update: (value: MediaTransform) => MediaTransform) {
    if (!this.value.draft) return;
    this.publish({
      draft: { ...this.value.draft, plan: update(this.value.draft.plan) },
      dirty: true,
      error: undefined,
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), 200);
  }
  replace(draft: MediaDraft) {
    this.revision = draft.revision;
    this.publish({ draft, dirty: false, saving: false, error: undefined });
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    const run = async () => {
      while (this.value.dirty && this.value.draft) {
        const plan = this.value.draft.plan;
        this.publish({ saving: true });
        try {
          const draft = mediaDraft(
            await this.api.media({ kind: 'update', id: this.id, revision: this.revision, plan }),
          );
          this.revision = draft.revision;
          this.publish({
            draft: { ...this.value.draft, revision: draft.revision },
            dirty: this.value.draft.plan !== plan,
            saving: false,
            error: undefined,
          });
        } catch (error) {
          this.publish({ saving: false, error: String((error as Error).message || error) });
          throw error;
        }
      }
    };
    const work = run();
    this.pending = work;
    void work.then(
      () => {
        if (this.pending === work) this.pending = undefined;
      },
      () => {
        if (this.pending === work) this.pending = undefined;
      },
    );
    return work;
  }
  dispose() {
    clearTimeout(this.timer);
    this.off();
  }
}
const owners = new WeakMap<ViewerAPI, Map<string, DraftSession>>();
export function mediaSession(id: string, api = window.viewer): DraftSession {
  let sessions = owners.get(api);
  if (!sessions) owners.set(api, (sessions = new Map()));
  let session = sessions.get(id);
  if (!session) {
    session = new DraftSession(id, api);
    sessions.set(id, session);
  }
  for (const [key, value] of sessions)
    if (sessions.size > 64 && !value.snapshot().dirty && !value.snapshot().saving && key !== id) {
      value.dispose();
      sessions.delete(key);
    }
  return session;
}
export async function flushMediaDrafts(api = window.viewer) {
  await Promise.all([...(owners.get(api)?.values() ?? [])].map((session) => session.flush()));
}
