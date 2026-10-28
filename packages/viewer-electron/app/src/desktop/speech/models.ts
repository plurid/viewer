import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  speechModels,
  speechSetupSchema,
  type SpeechModel,
  type SpeechSetup,
  type SpeechModelsSnapshot,
} from '../../domain/speech/models';
import type { SpeechRuntimeStatus } from '../../domain/speech/recognition';
import { formatBytes } from '../../domain/files/entries';
import { DocumentStore } from '../persistence/document-store';

const recordSchema = z
  .object({
    id: z.uuid(),
    model: z.string().max(100),
    file: z.string().regex(/^[a-z0-9-]+\.bin$/),
    status: z.enum(['downloading', 'ready', 'failed', 'cancelled']),
    received: z.number().int().min(0),
    identity: z.string().optional(),
    modified: z.number().optional(),
    error: z.string().max(1000).optional(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    selected: z.string().max(100).optional(),
    records: z.array(recordSchema).max(8),
  })
  .strict();
type ModelRecord = z.infer<typeof recordSchema>;
type ModelState = z.infer<typeof stateSchema>;
const weightsOnly =
  'Viewer manages model weights only. Audio recording and speech recognition are not available.';

function modelURL(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !(
      ['huggingface.co', 'cdn-lfs.huggingface.co'].includes(url.hostname) ||
      url.hostname.endsWith('.hf.co') ||
      url.hostname.endsWith('.xethub.hf.co')
    )
  )
    throw new Error('The model download redirected outside the approved HTTPS hosts.');
  return url;
}
async function download(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Response> {
  for (let redirects = 0; redirects < 6; redirects++) {
    const current = modelURL(url);
    const response = await fetcher(current, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('The model download returned an empty redirect.');
      url = new URL(location, current).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error('Model download failed (' + response.status + ').');
    return response;
  }
  throw new Error('The model download exceeded its redirect limit.');
}

/** Managed weights only. No executable, shell command, automatic cleanup or microphone authority. */
export class SpeechModels {
  private store: DocumentStore<ModelState>;
  private loaded?: Promise<ModelState>;
  private active = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    private directory: string,
    private catalog: readonly SpeechModel[] = speechModels,
    private fetcher: typeof fetch = fetch,
    private runtime: () => Promise<SpeechRuntimeStatus> = async () => ({
      name: 'whisper.cpp',
      recognitionAvailable: false,
      reason: weightsOnly,
    }),
    private changed: () => void = () => {},
  ) {
    const ids = new Set<string>();
    for (const model of catalog) {
      if (
        !/^[a-z0-9-]{1,100}$/.test(model.id) ||
        ids.has(model.id) ||
        !/^[a-f0-9]{64}$/.test(model.sha256) ||
        !Number.isSafeInteger(model.bytes) ||
        model.bytes < 1 ||
        model.bytes > 1024 ** 3
      )
        throw new Error('The speech model catalog contains an invalid or duplicate model.');
      modelURL(model.url);
      ids.add(model.id);
    }
    this.store = new DocumentStore(path.join(directory, 'speech-models-v1.json'), (value) =>
      stateSchema.parse(value),
    );
  }
  private state() {
    return (this.loaded ??= this.store
      .load()
      .then((value) => value ?? { version: 1 as const, records: [] })
      .catch((error) => {
        this.loaded = undefined;
        throw error;
      }));
  }
  private model(id: string): SpeechModel {
    const model = this.catalog.find((model) => model.id === id);
    if (!model) throw new Error('Choose a model from speech models.');
    return model;
  }
  private async folder(create = true): Promise<string> {
    const root = await realpath(this.directory);
    const folder = path.join(root, 'speech-models');
    if (create)
      await mkdir(folder, { mode: 0o700 }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(folder)) !== folder)
      throw new Error('The speech-model directory must be an ordinary private folder.');
    return folder;
  }
  private async usable(record: ModelRecord): Promise<boolean> {
    if (record.status !== 'ready') return false;
    try {
      const file = path.join(await this.folder(false), record.file),
        info = await lstat(file),
        model = this.model(record.model);
      return (
        info.isFile() &&
        !info.isSymbolicLink() &&
        info.size === model.bytes &&
        `${info.dev}:${info.ino}` === record.identity &&
        info.mtimeMs === record.modified
      );
    } catch {
      return false;
    }
  }
  async status(): Promise<SpeechModelsSnapshot> {
    const state = await this.state();
    const records = await Promise.all(
      state.records.map(async (record) => ({ ...record, available: await this.usable(record) })),
    );
    return {
      selected: state.selected,
      runtime: await this.runtime(),
      models: this.catalog.map((model) => ({
        ...model,
        installed: records.some((record) => record.model === model.id && record.available),
        selected: state.selected === model.id,
      })),
      records: records.map((record) => ({
        ...record,
        status:
          record.status === 'downloading' && !this.active.size ? 'interrupted' : record.status,
      })),
    };
  }
  async describe(input: SpeechSetup): Promise<string> {
    const setup = speechSetupSchema.parse(input),
      model = this.model(setup.model);
    const runtime = await this.runtime();
    const notice = runtime.recognitionAvailable
      ? 'Local transcription runs on this device. Microphone access is requested only when you start recording.'
      : weightsOnly;
    if (setup.kind === 'use') {
      if (!(await this.status()).models.some((item) => item.id === model.id && item.installed))
        throw new Error('Install and verify this speech model first.');
      return `Save ${model.name} as the selected local model. ${notice}`;
    }
    return `${setup.kind === 'import' ? 'Import' : 'Download'} ${model.name} (${formatBytes(model.bytes)}).\n${setup.kind === 'import' ? 'Source: ' + setup.source : 'Source: ' + model.url}\nDestination: ${path.join(this.directory, 'speech-models')}\nSHA-256: ${model.sha256}\nLicense: ${model.license}\nExisting models and any interrupted files remain in place.\n${notice}`;
  }
  request(input: SpeechSetup, operation: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Speech model management has closed.'));
    if (this.active.has(operation))
      return Promise.reject(new Error('This speech setup is already pending.'));
    const controller = new AbortController();
    this.active.set(operation, controller);
    const work = this.queue
      .catch(() => {})
      .then(() => this.apply(speechSetupSchema.parse(input), controller))
      .finally(() => this.active.delete(operation));
    this.queue = work;
    return work;
  }
  private async apply(setup: SpeechSetup, controller: AbortController): Promise<unknown> {
    if (this.closed) throw new Error('Speech model management has closed.');
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60_000)]);
    signal.throwIfAborted();
    const model = this.model(setup.model),
      state = await this.state();
    if (setup.kind === 'use') {
      await this.describe(setup);
      signal.throwIfAborted();
      state.selected = model.id;
      await this.store.save(state);
      this.changed();
      return this.status();
    }
    if ((await this.status()).models.some((item) => item.id === model.id && item.installed))
      return this.status();
    if (state.records.length >= 8)
      throw new Error(
        'Speech model storage contains eight retained downloads. Review them before starting another.',
      );
    const folder = await this.folder(),
      space = await statfs(folder);
    if (space.bavail * space.bsize < model.bytes + 1048576)
      throw new Error('There is not enough free storage for this model.');
    const record: ModelRecord = {
      id: randomUUID(),
      model: model.id,
      file: model.id + '-' + randomUUID() + '.bin',
      status: 'downloading',
      received: 0,
    };
    state.records.push(record);
    await this.store.save(state);
    this.changed();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        path.join(folder, record.file),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const hash = createHash('sha256');
      let lastSaved = 0;
      const saveChunk = async (bytes: Uint8Array) => {
        signal.throwIfAborted();
        if (record.received + bytes.length > model.bytes)
          throw new Error('The download exceeded the pinned model size.');
        let offset = 0;
        while (offset < bytes.length) {
          const written = await handle!.write(bytes, offset, bytes.length - offset);
          if (!written.bytesWritten) throw new Error('The model file stopped accepting data.');
          offset += written.bytesWritten;
        }
        hash.update(bytes);
        record.received += bytes.length;
        if (record.received - lastSaved >= 1048576) {
          await this.store.save(state);
          this.changed();
          lastSaved = record.received;
        }
      };
      if (setup.kind === 'import') {
        const source = await open(
          setup.source,
          constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const before = await source.stat();
          if (!before.isFile() || before.size !== model.bytes)
            throw new Error('This file does not match the selected model size.');
          const buffer = Buffer.alloc(1024 * 1024);
          while (true) {
            const read = await source.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead) break;
            await saveChunk(buffer.subarray(0, read.bytesRead));
          }
          const after = await source.stat();
          if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
            throw new Error('The imported model changed while reading.');
        } finally {
          await source.close();
        }
      } else {
        const response = await download(model.url, signal, this.fetcher);
        const length = response.headers.get('content-length');
        if (length && Number(length) !== model.bytes) {
          await response.body!.cancel();
          throw new Error('The server model size differs from the pinned catalog.');
        }
        const reader = response.body!.getReader();
        try {
          while (true) {
            const value = await reader.read();
            if (value.done) break;
            await saveChunk(value.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      if (record.received !== model.bytes || hash.digest('hex') !== model.sha256)
        throw new Error(
          'Model checksum verification failed. The unverified file was retained and was not selected.',
        );
      await handle.sync();
      const info = await handle.stat();
      signal.throwIfAborted();
      record.identity = `${info.dev}:${info.ino}`;
      record.modified = info.mtimeMs;
      record.status = 'ready';
      await this.store.save(state);
      this.changed();
      return this.status();
    } catch (error) {
      record.status = signal.aborted ? 'cancelled' : 'failed';
      // Shared model status must not disclose the private path of an imported file.
      record.error = signal.aborted
        ? 'Model setup was cancelled.'
        : 'Model setup failed. The unverified file was retained.';
      await this.store.save(state);
      this.changed();
      throw error;
    } finally {
      await handle?.close();
    }
  }
  cancel(id: string): void {
    this.active.get(id)?.abort();
  }
  async selectedFile() {
    const state = await this.state();
    const record = state.records.find(
      (item) => item.model === state.selected && item.status === 'ready',
    );
    if (!record || !(await this.usable(record)))
      throw new Error('Choose an installed speech model in Settings → Speech.');
    const model = this.model(record.model);
    return {
      file: path.join(await this.folder(false), record.file),
      model: model.id,
      recordID: record.id,
    };
  }
  async validateSelection(recordID: string): Promise<void> {
    const record = (await this.state()).records.find((item) => item.id === recordID);
    if (!record || !(await this.usable(record)))
      throw new Error('The speech model changed during transcription. Verify or import it again.');
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active.values()) controller.abort();
    await this.queue.catch(() => {});
    await this.store.flush();
  }
}
