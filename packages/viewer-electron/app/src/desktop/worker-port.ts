import { parentPort } from 'node:worker_threads';

/** Normalize Node threads and Electron utility-process messages without giving
 * either worker access to Electron's main-process APIs or a renderer. */
export const workerPort = parentPort
  ? {
      postMessage: (value: unknown) => parentPort!.postMessage(value),
      on: (_event: 'message', listener: (event: { data: unknown }) => void) =>
        parentPort!.on('message', (data: unknown) => listener({ data })),
    }
  : process.parentPort;
