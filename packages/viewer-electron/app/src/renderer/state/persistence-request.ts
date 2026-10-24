type PersistenceScheduler = (flushEngine: boolean) => void;

let schedule: PersistenceScheduler | undefined;
let pending: boolean | undefined;

/** The immutable store announces dirty state without importing its persistence adapter. */
export function requestPersistence(flushEngine: boolean): void {
  if (schedule) schedule(flushEngine);
  else pending = !!pending || flushEngine;
}

export function installPersistenceScheduler(scheduler: PersistenceScheduler): void {
  schedule = scheduler;
  if (pending !== undefined) {
    const flushEngine = pending;
    pending = undefined;
    scheduler(flushEngine);
  }
}
