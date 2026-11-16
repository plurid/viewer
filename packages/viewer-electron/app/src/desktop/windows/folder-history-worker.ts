import { checkHistoryFolder } from '../files/folder-history';
import { workerPort } from '../workers/worker-port';

workerPort.on('message', (event) => {
  const path = event.data as string;
  try {
    workerPort.postMessage({ value: checkHistoryFolder(path) });
  } catch {
    workerPort.postMessage({ value: { directory: false, unavailable: true } });
  }
});
