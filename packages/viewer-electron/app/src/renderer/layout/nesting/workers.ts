/** The panel's workers, made in one place so tests can stand in for them. */
export const nestingWorkers = {
  parts: () => new Worker(new URL('./parts.worker.ts', import.meta.url), { type: 'module' }),
  nest: () => new Worker(new URL('./nest.worker.ts', import.meta.url), { type: 'module' }),
};
