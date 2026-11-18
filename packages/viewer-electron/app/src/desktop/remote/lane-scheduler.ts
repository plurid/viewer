import { remoteLimits } from '../../domain/remote/limits';

interface Job {
  thumbnail: boolean;
  run(): Promise<void>;
}

export interface LaneSchedulerOptions {
  /** Requests running at once on the lane. */
  concurrency?: number;
  /** Thumbnail requests running at once; they never hold a slot foreground work is waiting for. */
  thumbnails?: number;
}

/**
 * One lane's queue in the servers worker. Foreground work starts first, in the order it came;
 * thumbnails take what is left, a few at a time, so a folder of photos never delays a listing.
 */
export class LaneScheduler {
  private queued: Job[] = [];
  private active = 0;
  private thumbnails = 0;
  private readonly concurrency: number;
  private readonly thumbnailLimit: number;

  constructor(options: LaneSchedulerOptions = {}) {
    this.concurrency = options.concurrency ?? 16;
    this.thumbnailLimit = options.thumbnails ?? remoteLimits.thumbnailsPerConnection;
  }

  get running(): { active: number; thumbnails: number; queued: number } {
    return { active: this.active, thumbnails: this.thumbnails, queued: this.queued.length };
  }

  run<T>(signal: AbortSignal, thumbnail: boolean, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        thumbnail,
        run: async () => {
          try {
            // A request canceled while it waited never reaches the server.
            signal.throwIfAborted();
            resolve(await work());
          } catch (error) {
            reject(error);
          }
        },
      };
      // Foreground work goes ahead of every queued thumbnail, behind earlier foreground work.
      const firstThumbnail = this.queued.findIndex((item) => item.thumbnail);
      if (thumbnail || firstThumbnail < 0) {
        this.queued.push(job);
      } else {
        this.queued.splice(firstThumbnail, 0, job);
      }
      this.pump();
    });
  }

  private next(): Job | undefined {
    const index = this.queued.findIndex(
      (job) => !job.thumbnail || this.thumbnails < this.thumbnailLimit,
    );
    return index < 0 ? undefined : this.queued.splice(index, 1)[0];
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const job = this.next();
      if (!job) {
        return;
      }
      this.active++;
      if (job.thumbnail) {
        this.thumbnails++;
      }
      void job.run().finally(() => {
        this.active--;
        if (job.thumbnail) {
          this.thumbnails--;
        }
        this.pump();
      });
    }
  }
}
