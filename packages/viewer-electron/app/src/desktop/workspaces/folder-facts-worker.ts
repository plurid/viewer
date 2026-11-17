import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { FolderFactsRequest, FolderFactsMessage } from '../../domain/workspaces/folder-facts';
import { readFolderFile, probeFolder } from './folder-facts-io';
import { workerPort } from '../workers/worker-port';

let pending: { request: FolderFactsRequest; actual: string } | undefined;
workerPort.on('message', ({ data }) => {
  const message = data as FolderFactsMessage;
  if (message.kind !== 'allow') {
    try {
      const actual = realpathSync.native(message.path);
      const files: string[] = [];
      if (message.kind === 'probe' && !message.identityOnly)
        for (const name of ['.git', 'package.json']) {
          try {
            files.push(realpathSync.native(path.join(actual, name)));
          } catch {
            // Missing metadata does not prevent the bounded marker scan.
          }
        }
      pending = { request: message, actual };
      workerPort.postMessage({ id: message.id, check: actual, files });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      workerPort.postMessage({
        id: message.id,
        value: {
          ok: false,
          reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable',
        },
      });
    }
    return;
  }
  const work = pending;
  pending = undefined;
  if (!work || work.request.id !== message.id) return;
  const { request, actual } = work;
  if (!message.allowed) {
    workerPort.postMessage({ id: request.id, value: { ok: false, reason: 'scope' } });
    return;
  }
  const value =
    request.kind === 'read'
      ? readFolderFile(request.path, request.maxBytes, actual)
      : probeFolder(request.path, actual, new Set(message.files ?? []), request.identityOnly);
  workerPort.postMessage({ id: request.id, value, files: message.files });
});
