import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  speechPreferencesSchema,
  speechRequestSchema,
  speechMaximumSeconds,
  type SpeechPreferences,
  type SpeechReply,
  type SpeechRequest,
  type SpeechSessionEvent,
  type SpeechSetupTask,
  type SpeechStatus,
  type SpeechCaptureStart,
} from '../../domain/speech/recognition';
import type { SpeechModels } from './models';
import type { SpeechRuntime } from './runtime';
import { DocumentStore } from '../persistence/document-store';
import { errorMessage } from '../../domain/errors';

interface Session {
  id: string;
  owner: number;
  state: 'requesting' | 'listening' | 'transcribing';
  controller: AbortController;
  preferences: SpeechPreferences;
  selected?: Awaited<ReturnType<SpeechModels['selectedFile']>>;
  timer: ReturnType<typeof setTimeout>;
}
interface Ports {
  settings(owner: number): boolean;
  human(owner: number): boolean;
  foreground?(owner: number): boolean;
  microphone(): SpeechStatus['microphone'];
  requestMicrophone(owner: number): Promise<boolean>;
  chooseModel(owner: number): Promise<string | undefined>;
  event(owner: number, event: SpeechSessionEvent): void;
  changed(): void;
}

/** One explicit capture/inference at a time. Audio and transcripts never enter persistence. */
export class Speech {
  private store: DocumentStore<SpeechPreferences>;
  private preferences?: Promise<SpeechPreferences>;
  private session?: Session;
  private setup = new Map<string, { owner: number; task: SpeechSetupTask; work: Promise<void> }>();
  private work?: Promise<SpeechReply>;
  private transcribing = false;
  private closed = false;
  constructor(
    directory: string,
    private models: Pick<
      SpeechModels,
      'status' | 'describe' | 'request' | 'cancel' | 'selectedFile' | 'validateSelection'
    >,
    private runtime: Pick<SpeechRuntime, 'status' | 'transcribe'>,
    private ports: Ports,
  ) {
    this.store = new DocumentStore(path.join(directory, 'speech-preferences-v1.json'), (value) =>
      speechPreferencesSchema.parse(value),
    );
  }
  private settings(owner: number) {
    if (!this.ports.settings(owner)) throw new Error('Configure speech in Settings.');
  }
  private prefs() {
    return (this.preferences ??= this.store
      .load()
      .then((value) => value ?? speechPreferencesSchema.parse({}))
      .catch((error) => {
        this.preferences = undefined;
        throw error;
      }));
  }
  async status(owner: number): Promise<SpeechStatus> {
    return {
      models: await this.models.status(),
      preferences: await this.prefs(),
      microphone: this.ports.microphone(),
      setup: [...this.setup.values()]
        .filter((item) => item.owner === owner)
        .map((item) => item.task),
    };
  }
  async request(raw: SpeechRequest, owner: number): Promise<SpeechReply> {
    if (this.closed || !this.ports.human(owner))
      throw new Error('Speech input is available only to the person in a trusted Viewer window.');
    const request = speechRequestSchema.parse(raw);
    if (request.kind === 'status') return this.status(owner);
    if (request.kind === 'preferences') {
      this.settings(owner);
      await this.store.save(request.preferences);
      this.preferences = Promise.resolve(request.preferences);
      this.ports.changed();
      return this.status(owner);
    }
    if (request.kind === 'setup') {
      this.settings(owner);
      if ([...this.setup.values()].filter((item) => item.task.state === 'running').length >= 4)
        throw new Error('Finish or cancel a pending speech setup first.');
      const source = request.action === 'import' ? await this.ports.chooseModel(owner) : undefined;
      if (request.action === 'import' && !source) return null;
      const setup = source
        ? { kind: 'import' as const, model: request.model, source }
        : { kind: request.action as 'install' | 'use', model: request.model };
      await this.models.describe(setup);
      if (this.closed || !this.ports.human(owner))
        throw new Error('The speech settings window closed.');
      if ([...this.setup.values()].filter((item) => item.task.state === 'running').length >= 4)
        throw new Error('Finish or cancel a pending speech setup first.');
      const id = randomUUID(),
        task: SpeechSetupTask = { id, model: request.model, state: 'running' };
      for (const [key, item] of this.setup)
        if (this.setup.size >= 8 && item.task.state !== 'running') this.setup.delete(key);
      const work = this.models
        .request(setup, id)
        .then(async () => {
          if (task.state !== 'running') return;
          if (setup.kind !== 'use')
            await this.models.request({ kind: 'use', model: setup.model }, id);
          if (task.state === 'running') task.state = 'completed';
        })
        .catch((error) => {
          if (task.state === 'running') {
            task.state = 'failed';
            task.message = errorMessage(error);
          }
        })
        .finally(() => this.ports.changed());
      this.setup.set(id, { owner, task, work });
      this.ports.changed();
      return { id };
    }
    if (request.kind === 'cancel-setup') {
      const setup = this.setup.get(request.id);
      if (!setup || setup.owner !== owner) throw new Error('This setup belongs to another window.');
      setup.task.state = 'cancelled';
      this.models.cancel(request.id);
      this.ports.changed();
      return null;
    }
    if (request.kind === 'cancel') {
      if (this.session && (this.session.owner !== owner || this.session.id !== request.id))
        throw new Error('This recording belongs to another window.');
      this.cancelSession(owner);
      return null;
    }
    if (request.kind === 'begin') return this.begin(owner, request.id);
    const session = this.session;
    if (
      !session ||
      session.owner !== owner ||
      session.id !== request.id ||
      session.state !== 'listening'
    )
      throw new Error('This recording has ended or belongs to another window.');
    session.state = 'transcribing';
    clearTimeout(session.timer);
    this.transcribing = true;
    this.ports.event(owner, { id: session.id, state: 'transcribing' });
    this.work = (async () => {
      try {
        const selected = session.selected;
        if (!selected) throw new Error('The speech model is no longer available.');
        const result = await this.runtime.transcribe(
          selected.file,
          selected.model,
          request.pcm,
          session.preferences.language,
          session.controller.signal,
        );
        session.controller.signal.throwIfAborted();
        await this.models.validateSelection(selected.recordID);
        session.controller.signal.throwIfAborted();
        this.ports.event(owner, { id: session.id, state: 'completed' });
        return result;
      } catch (error) {
        if (!session.controller.signal.aborted)
          this.ports.event(owner, {
            id: session.id,
            state: 'failed',
            message: errorMessage(error),
          });
        throw error;
      } finally {
        this.transcribing = false;
        if (this.session === session) this.session = undefined;
      }
    })();
    return this.work;
  }
  private async begin(owner: number, id: string): Promise<SpeechCaptureStart> {
    if (this.session || this.transcribing)
      throw new Error('Finish or cancel the current recording first.');
    const controller = new AbortController();
    // Reserve before any asynchronous work so releasing a held key cannot start a late recording.
    const session: Session = {
      id,
      owner,
      state: 'requesting',
      controller,
      preferences: speechPreferencesSchema.parse({}),
      timer: setTimeout(() => this.cancelSession(owner), (speechMaximumSeconds + 15) * 1000),
    };
    this.session = session;
    try {
      const status = await this.runtime.status();
      controller.signal.throwIfAborted();
      if (!status.recognitionAvailable) throw new Error(status.reason);
      session.selected = await this.models.selectedFile();
      session.preferences = await this.prefs();
      controller.signal.throwIfAborted();
      if (this.closed || !this.ports.human(owner))
        throw new Error('Speech capture is no longer available.');
      if (!(await this.ports.requestMicrophone(owner)))
        throw new Error(
          'Microphone access is denied. Allow Viewer in System Settings → Privacy & Security → Microphone, then try again.',
        );
      controller.signal.throwIfAborted();
      if (
        this.session !== session ||
        !this.ports.human(owner) ||
        this.ports.foreground?.(owner) === false
      )
        throw new Error('The recording was cancelled.');
      session.state = 'listening';
      this.ports.event(owner, { id, state: 'listening' });
      return { id, preferences: session.preferences };
    } catch (error) {
      clearTimeout(session.timer);
      if (this.session === session) this.session = undefined;
      throw error;
    }
  }
  allowsMicrophone(owner: number): boolean {
    return (
      !!this.session &&
      this.session.owner === owner &&
      this.session.state === 'listening' &&
      this.ports.human(owner)
    );
  }
  stopRecording(owner: number): void {
    this.cancelSession(owner);
  }
  private cancelSession(owner: number): void {
    const session = this.session;
    if (session?.owner === owner) {
      clearTimeout(session.timer);
      session.controller.abort();
      this.session = undefined;
      this.ports.event(owner, { id: session.id, state: 'cancelled' });
    }
  }
  stopOwner(owner: number): void {
    this.cancelSession(owner);
    for (const { owner: initiator, task } of this.setup.values())
      if (owner === initiator && task.state === 'running') {
        task.state = 'cancelled';
        this.models.cancel(task.id);
      }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.session) this.stopOwner(this.session.owner);
    for (const { owner } of this.setup.values()) this.stopOwner(owner);
    await Promise.allSettled([...this.setup.values()].map((item) => item.work));
    await this.work?.catch(() => {});
    await this.store.flush();
  }
}
