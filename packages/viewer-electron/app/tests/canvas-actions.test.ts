import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Canvases } from '../src/desktop/canvases/service';
import { CanvasActions } from '../src/desktop/canvases/actions';
import { validateCanvasActionInput } from '../src/domain/canvases/actions';
import type { CanvasAction, CanvasActionEvent } from '../src/domain/canvases/actions';
import { temporaryRoot } from '../tools/temporary';

const definition: CanvasAction = {
  id: 'total',
  label: 'Calculate total',
  inputSchema: {
    type: 'object',
    properties: { multiplier: { type: 'number', minimum: 1, maximum: 10 } },
    required: ['multiplier'],
    additionalProperties: false,
  },
};
async function setup() {
  const root = await temporaryRoot('viewer-canvas-actions-');
  const events: CanvasActionEvent[] = [];
  const canvases = new Canvases(root, {
    changed() {},
    action: (_owner, event) => events.push(event),
  });
  let doc = await canvases.create(1, randomUUID(), root);
  doc = await canvases.write(1, doc.id, 0, 'Table calculator', '<p>Fixture</p>', { total: 0 });
  const frame = randomUUID();
  await canvases.registerActions(1, doc.id, doc.revision, frame, [definition]);
  const run = (signal = new AbortController().signal) =>
    canvases.invoke(
      1,
      doc.id,
      doc.revision,
      doc.stateRevision,
      'total',
      { multiplier: 2 },
      'You',
      signal,
      doc.conversationID,
    );
  const started = async () => {
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'invoke')).toBe(true));
    return events.find((e) => e.kind === 'invoke')!;
  };
  return { canvases, doc, frame, events, run, started, root };
}
describe('generated canvas actions', () => {
  it('validates missing, additional, wrong-type and out-of-range inputs', () => {
    for (const input of [
      {},
      { multiplier: '2' },
      { multiplier: 11 },
      { multiplier: 2, extra: true },
    ])
      expect(() => validateCanvasActionInput(definition, input)).toThrow();
    expect(validateCanvasActionInput(definition, { multiplier: 2 })).toEqual({ multiplier: 2 });
  });
  it('returns actual non-robot output and commits one state revision without reloading content', async () => {
    const { canvases, doc, frame, run, started } = await setup();
    const pending = run();
    const event = await started();
    const total = [7, 11].reduce((sum, v) => sum + v, 0) * Number(event.run.input.multiplier);
    canvases.actions.complete(1, doc.id, frame, event.run.id, {
      result: { total },
      patch: { total },
    });
    const reply = await pending;
    expect(reply.actionRun).toMatchObject({
      status: 'completed',
      result: { total: 36 },
      actorKind: 'model',
    });
    expect(reply.document.state).toEqual({ total: 36 });
    expect(reply.document.revision).toBe(doc.revision);
    expect(reply.document.stateRevision).toBe(doc.stateRevision + 1);
  });
  it('rejects another window, conversation, frame, duplicate invocation and late response', async () => {
    const { canvases, doc, frame, run, started } = await setup();
    await expect(
      canvases.invoke(
        2,
        doc.id,
        doc.revision,
        doc.stateRevision,
        'total',
        { multiplier: 2 },
        'You',
        new AbortController().signal,
      ),
    ).rejects.toThrow('another window');
    await expect(
      canvases.invoke(
        1,
        doc.id,
        doc.revision,
        doc.stateRevision,
        'total',
        { multiplier: 2 },
        'You',
        new AbortController().signal,
        randomUUID(),
      ),
    ).rejects.toThrow('another conversation');
    const pending = run();
    const event = await started();
    await expect(run()).rejects.toThrow('already running');
    expect(() =>
      canvases.actions.complete(2, doc.id, frame, event.run.id, { result: 1 }),
    ).toThrow();
    expect(() =>
      canvases.actions.complete(1, doc.id, randomUUID(), event.run.id, { result: 1 }),
    ).toThrow();
    canvases.actions.cancel(doc.id);
    expect((await pending).actionRun.status).toBe('cancelled');
    expect(() =>
      canvases.actions.complete(1, doc.id, frame, event.run.id, { result: 1 }),
    ).toThrow();
  });
  it.each(['revision', 'detach', 'abort'] as const)('discards a result after %s', async (cause) => {
    const { canvases, doc, frame, run, started } = await setup();
    const abort = new AbortController();
    const pending = run(abort.signal).catch((error: unknown) => error);
    await started();
    if (cause === 'revision')
      await canvases.write(1, doc.id, doc.revision, 'New', '<p>New</p>', {});
    if (cause === 'detach') canvases.actions.detach(1, doc.id, frame);
    if (cause === 'abort') abort.abort();
    await pending;
    expect((await canvases.read(1, doc.id)).state.total).toBe(0);
    expect(canvases.actions.activity(doc.id)?.status).toBe('cancelled');
  });
  it('refuses stale input revisions and actions after a cold restart', async () => {
    const { canvases, doc, run, root } = await setup();
    await canvases.state(1, doc.id, doc.stateRevision, doc.revision, { total: 5 });
    await expect(run()).rejects.toThrow('inputs changed');
    await canvases.flush();
    const restarted = new Canvases(root, { changed() {} });
    const current = await restarted.read(1, doc.id);
    await expect(
      restarted.invoke(
        1,
        doc.id,
        current.revision,
        current.stateRevision,
        'total',
        { multiplier: 2 },
        'You',
        new AbortController().signal,
      ),
    ).rejects.toThrow('Open the current canvas');
  });
  it('does not commit invalid patches or oversized results', async () => {
    for (const output of [
      { result: 1, patch: { total: 'wrong type' } },
      { result: 'x'.repeat(32001), patch: { total: 9 } },
    ]) {
      const { canvases, doc, frame, run, started } = await setup();
      const pending = run(),
        event = await started();
      canvases.actions.complete(1, doc.id, frame, event.run.id, output);
      expect((await pending).actionRun.status).toBe('failed');
      expect((await canvases.read(1, doc.id)).state.total).toBe(0);
    }
  });
  it('bounds a handler that never replies', async () => {
    const { doc } = await setup();
    const broker = new CanvasActions(() => {}, 10);
    broker.register(1, doc, randomUUID(), [definition]);
    const pending = broker.start(
      1,
      doc,
      'total',
      { multiplier: 1 },
      'You',
      new AbortController().signal,
    );
    await expect(pending.result).rejects.toThrow('30-second limit');
    expect(broker.busy(doc.id)).toBe(false);
  });
  it('does not describe an accepted persistence commit as cancelled', async () => {
    const { doc } = await setup();
    const broker = new CanvasActions(() => {});
    const frame = randomUUID();
    const abort = new AbortController();
    broker.register(1, doc, frame, [definition]);
    const pending = broker.start(1, doc, 'total', { multiplier: 1 }, 'You', abort.signal);
    broker.complete(1, doc.id, frame, pending.run.id, { result: 2, patch: { total: 2 } });
    await pending.result;
    broker.commit(doc.id, pending.run.id, abort.signal);
    abort.abort();
    broker.cancel(doc.id);
    broker.finish(doc.id, pending.run.id, 'completed', 2);
    expect(broker.activity(doc.id)?.status).toBe('completed');
  });
});
