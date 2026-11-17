import type { ActiveFolderScope } from '../files/file-access';
import type { OwnedWorker } from '../workers/utility-client';
import { launchWorker } from '../workers/utility-client';
import type {
  FolderFactsRequest,
  FolderFactsReply,
  FolderRead,
  FolderProbeResult,
  FolderFactsFailure,
} from '../../domain/workspaces/folder-facts';
import { folderFactsLimits } from '../../domain/workspaces/folder-facts';
import { folderVolume } from '../../domain/files/folder-checks';
import path from 'node:path';
import { containsPath } from '../files/containment';

export interface FolderFactsPass {
  relaunches: number;
  exhausted: boolean;
}
interface Request {
  request: FolderFactsRequest;
  pass: FolderFactsPass;
  scope?: ActiveFolderScope;
  resolve(value: FolderRead | FolderProbeResult): void;
}
interface FolderFactsOptions {
  access?(path: string): ActiveFolderScope | undefined;
  worker?(): OwnedWorker<FolderFactsReply>;
  now?(): number;
  report?(message: string): void;
}

/** Read priority and pass budgets belong here so finding projects never blocks a command picker. */
export class FolderFacts {
  private worker?: OwnedWorker<FolderFactsReply>;
  private reads: Request[] = [];
  private probes: Request[] = [];
  private blocked = new Map<string, number>();
  private retiring = new Set<OwnedWorker<FolderFactsReply>>();
  private active?: Request;
  private timer?: ReturnType<typeof setTimeout>;
  private serial = 0;
  private closed = false;

  constructor(
    private workerPath: string,
    private options: FolderFactsOptions = {},
  ) {}

  pass(): FolderFactsPass {
    return { relaunches: 0, exhausted: false };
  }

  read(path: string, maxBytes: number, pass = this.pass()): Promise<FolderRead> {
    return this.enqueue(
      { id: ++this.serial, kind: 'read', path, maxBytes },
      pass,
    ) as Promise<FolderRead>;
  }

  probe(path: string, pass = this.pass()): Promise<FolderProbeResult> {
    return this.enqueue(
      { id: ++this.serial, kind: 'probe', path },
      pass,
    ) as Promise<FolderProbeResult>;
  }

  private enqueue(request: FolderFactsRequest, pass: FolderFactsPass) {
    return new Promise<FolderRead | FolderProbeResult>((resolve) => {
      (request.kind === 'read' ? this.reads : this.probes).push({ request, pass, resolve });
      this.next();
    });
  }

  private next(): void {
    if (this.active) return;
    const task = this.reads.shift() ?? this.probes.shift();
    if (!task) return;
    const folder = path.resolve(
      task.request.kind === 'read' ? path.dirname(task.request.path) : task.request.path,
    );
    const volume = folderVolume(folder) ?? folder;
    const now = this.options.now?.() ?? Date.now();
    const scope = this.options.access?.(task.request.path);
    const refuse = (reason: FolderFactsFailure['reason']) => {
      task.resolve({ ok: false, reason });
      this.next();
    };
    if (this.closed) return refuse('closed');
    if (task.pass.exhausted) return refuse('budget');
    for (const [blocked, until] of this.blocked) {
      if (until <= now) this.blocked.delete(blocked);
      else if (containsPath(blocked, folder)) return refuse('quarantined');
    }
    if (this.options.access && !scope) return refuse('scope');
    if (!this.worker && this.retiring.size >= folderFactsLimits.stuckThreads) return refuse('busy');
    task.scope = scope;
    this.active = task;
    try {
      if (!this.worker) {
        const worker =
          this.options.worker?.() ??
          launchWorker<FolderFactsReply>(this.workerPath, 'Viewer folder facts', 'thread');
        this.worker = worker;
        worker.message((reply) => {
          const current = this.active;
          if (this.worker !== worker || current?.request.id !== reply.id) return;
          if ('check' in reply) {
            const allowed =
              !this.options.access ||
              (!!this.options.access(current.request.path) && !!current.scope?.allows(reply.check));
            const files = (reply.files ?? []).filter(
              (file) => !this.options.access || !!this.options.access(file)?.allows(file),
            );
            worker.postMessage({ id: reply.id, kind: 'allow', allowed, files });
            return;
          }
          const value = reply.value;
          this.finish(
            value.ok &&
              current.scope &&
              (!this.options.access?.(current.request.path) ||
                !current.scope.allows(value.path) ||
                reply.files?.some((file) => !this.options.access?.(file)?.allows(file)))
              ? { ok: false, reason: 'scope' }
              : value,
          );
        });
        const failed = () => {
          if (this.worker !== worker) return;
          this.worker = undefined;
          this.finish({ ok: false, reason: 'unavailable' });
        };
        worker.exit(() => {
          this.retiring.delete(worker);
          failed();
        });
        worker.thread?.on('error', failed);
      }
      this.timer = setTimeout(() => {
        const worker = this.worker;
        this.worker = undefined;
        if (task.pass.relaunches >= folderFactsLimits.relaunches) task.pass.exhausted = true;
        else task.pass.relaunches++;
        this.blocked.set(
          volume,
          (this.options.now?.() ?? Date.now()) + folderFactsLimits.quarantine,
        );
        this.retire(worker);
        this.finish({ ok: false, reason: 'timeout' });
      }, folderFactsLimits.timeout);
      this.worker.postMessage(task.request);
    } catch {
      this.finish({ ok: false, reason: 'unavailable' });
    }
  }

  private finish(value: FolderRead | FolderProbeResult): void {
    clearTimeout(this.timer);
    const task = this.active;
    this.active = undefined;
    task?.resolve(value);
    this.next();
  }

  private retire(worker?: OwnedWorker<FolderFactsReply>): void {
    if (!worker?.thread) return;
    this.retiring.add(worker);
    try {
      void worker.thread.terminate().then(
        () => this.retiring.delete(worker),
        () => {},
      );
    } catch {
      // A failed termination retains its slot until the owned thread actually exits.
    }
    if (this.retiring.size >= folderFactsLimits.stuckThreads)
      this.options.report?.('Folder discovery paused: timed-out worker threads have not stopped.');
  }

  close(): void {
    this.closed = true;
    const worker = this.worker;
    this.worker = undefined;
    this.finish({ ok: false, reason: 'closed' });
    this.retire(worker);
  }
}
