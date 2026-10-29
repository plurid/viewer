import { describe, expect, it, vi } from 'vitest';
import { QuitSequence } from '../src/desktop/windows/quit-sequence';
import type { QuitChoice, QuitHost, QuitPhase } from '../src/desktop/windows/quit-sequence';

type QuitInput = 'before-quit' | 'will-quit' | 'exit-headless';

class TestEvent {
  prevented = false;
  preventDefault() {
    this.prevented = true;
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(pending: number) {
  const answer = deferred<QuitChoice>();
  const drained = deferred<void>();
  const saved = deferred<boolean>();
  const stopped = deferred<void>();
  const disposed = deferred<void>();
  const host = {
    pendingOperations: vi.fn(() => pending),
    confirm: vi.fn((_pending: number) => answer.promise),
    drained: vi.fn(() => drained.promise),
    save: vi.fn(() => saved.promise),
    stopGuests: vi.fn(() => stopped.promise),
    dispose: vi.fn<() => Promise<void> | undefined>(() => disposed.promise),
    closeHotkey: vi.fn(),
    quit: vi.fn(),
    report: vi.fn(),
  } satisfies QuitHost;
  const sequence = new QuitSequence(host);
  return { host, sequence, answer, drained, saved, stopped, disposed };
}

/** A sequence brought to `phase` through its ports, as Electron and the person would. */
async function at(phase: QuitPhase) {
  const asking = phase === 'confirming' || phase === 'draining';
  const quit = fixture(asking ? 1 : 0);
  const steps: [QuitPhase, () => void][] = asking
    ? [
        ['running', () => quit.sequence.beforeQuit(new TestEvent())],
        ['confirming', () => quit.answer.resolve('wait')],
      ]
    : [
        ['running', () => quit.sequence.beforeQuit(new TestEvent())],
        ['saving', () => quit.saved.resolve(true)],
        ['stopping-guests', () => quit.stopped.resolve()],
        ['closing-windows', () => quit.sequence.willQuit(new TestEvent())],
        ['disposing', () => quit.disposed.resolve()],
      ];
  for (const [from, step] of steps) {
    if (from === phase) break;
    step();
    await settle();
  }
  expect(quit.sequence.phase()).toBe(phase);
  return quit;
}

function send(sequence: QuitSequence, input: QuitInput, event: TestEvent): void {
  if (input === 'before-quit') sequence.beforeQuit(event);
  else if (input === 'will-quit') sequence.willQuit(event);
  else sequence.exitHeadless();
}

describe('Quit sequence', () => {
  // phase, input, next phase or a thrown defect, whether Electron's event was held back
  it.each<[QuitPhase, QuitInput, QuitPhase | 'throws', boolean]>([
    ['running', 'before-quit', 'saving', true],
    ['running', 'will-quit', 'disposing', true],
    ['running', 'exit-headless', 'closing-windows', false],
    ['confirming', 'before-quit', 'confirming', true],
    ['confirming', 'will-quit', 'disposing', true],
    ['confirming', 'exit-headless', 'throws', false],
    ['draining', 'before-quit', 'draining', true],
    ['draining', 'will-quit', 'disposing', true],
    ['draining', 'exit-headless', 'throws', false],
    ['saving', 'before-quit', 'saving', true],
    ['saving', 'will-quit', 'disposing', true],
    ['saving', 'exit-headless', 'throws', false],
    ['stopping-guests', 'before-quit', 'stopping-guests', true],
    ['stopping-guests', 'will-quit', 'disposing', true],
    ['stopping-guests', 'exit-headless', 'throws', false],
    ['closing-windows', 'before-quit', 'closing-windows', false],
    ['closing-windows', 'will-quit', 'disposing', true],
    ['closing-windows', 'exit-headless', 'closing-windows', false],
    ['disposing', 'before-quit', 'disposing', false],
    ['disposing', 'will-quit', 'disposing', true],
    ['disposing', 'exit-headless', 'disposing', false],
    ['disposed', 'before-quit', 'disposed', false],
    ['disposed', 'will-quit', 'disposed', false],
    ['disposed', 'exit-headless', 'disposed', false],
  ])('%s, %s: %s (held back: %s)', async (phase, input, next, held) => {
    const quit = await at(phase);
    const event = new TestEvent();
    if (next === 'throws')
      expect(() => send(quit.sequence, input, event)).toThrow(`Quit cannot move from ${phase}`);
    else send(quit.sequence, input, event);
    expect(quit.sequence.phase()).toBe(next === 'throws' ? phase : next);
    expect(event.prevented).toBe(held);
  });

  it.each<[QuitPhase, boolean, boolean]>([
    ['running', true, false],
    ['confirming', true, false],
    ['draining', true, false],
    ['saving', false, false],
    ['stopping-guests', false, false],
    ['closing-windows', false, true],
    ['disposing', false, true],
    ['disposed', false, true],
  ])('%s: accepting %s, closing windows %s', async (phase, accepting, closingWindows) => {
    const quit = await at(phase);
    expect(quit.sequence.accepting()).toBe(accepting);
    expect(quit.sequence.closingWindows()).toBe(closingWindows);
  });

  it('asks before quitting with file operations in progress', async () => {
    const quit = fixture(3);
    quit.sequence.beforeQuit(new TestEvent());
    expect(quit.sequence.phase()).toBe('confirming');
    expect(quit.host.confirm).toHaveBeenCalledExactlyOnceWith(3);
    expect(quit.host.save).not.toHaveBeenCalled();
  });

  it.each<[QuitChoice, QuitPhase]>([
    ['keep-open', 'running'],
    ['cancel-operations', 'saving'],
    ['wait', 'draining'],
  ])('answering %s moves to %s', async (choice, next) => {
    const quit = await at('confirming');
    quit.answer.resolve(choice);
    await settle();
    expect(quit.sequence.phase()).toBe(next);
    expect(quit.host.drained).toHaveBeenCalledTimes(choice === 'wait' ? 1 : 0);
  });

  it('asks again on the next Quit after Keep Viewer open', async () => {
    const quit = await at('confirming');
    quit.answer.resolve('keep-open');
    await settle();
    quit.sequence.beforeQuit(new TestEvent());
    expect(quit.sequence.phase()).toBe('confirming');
    expect(quit.host.confirm).toHaveBeenCalledTimes(2);
  });

  it('saves once file operations finish', async () => {
    const quit = await at('draining');
    expect(quit.host.save).not.toHaveBeenCalled();
    quit.drained.resolve();
    await settle();
    expect(quit.sequence.phase()).toBe('saving');
    expect(quit.host.save).toHaveBeenCalledOnce();
  });

  it.each<[string, QuitPhase]>([
    ['the question fails', 'confirming'],
    ['waiting for file operations fails', 'draining'],
  ])('returns to running when %s', async (_failure, phase) => {
    const quit = await at(phase);
    const error = new Error('Unavailable');
    if (phase === 'confirming') quit.answer.reject(error);
    else quit.drained.reject(error);
    await settle();
    expect(quit.sequence.phase()).toBe('running');
    expect(quit.host.report).toHaveBeenCalledExactlyOnceWith('Quit confirmation failed', error);
    expect(quit.host.save).not.toHaveBeenCalled();
  });

  it('returns to running when the person keeps Viewer open after a failed save', async () => {
    const quit = await at('saving');
    quit.saved.resolve(false);
    await settle();
    expect(quit.sequence.phase()).toBe('running');
    expect(quit.host.stopGuests).not.toHaveBeenCalled();
    expect(quit.host.report).not.toHaveBeenCalled();
  });

  it.each<[string, QuitPhase]>([
    ['saving', 'saving'],
    ['stopping browser guests', 'stopping-guests'],
  ])('returns to running and reports when %s fails', async (_failure, phase) => {
    const quit = await at(phase);
    const error = new Error('Unavailable');
    if (phase === 'saving') quit.saved.reject(error);
    else quit.stopped.reject(error);
    await settle();
    expect(quit.sequence.phase()).toBe('running');
    expect(quit.host.report).toHaveBeenCalledExactlyOnceWith(
      'Viewer could not finish quitting',
      error,
    );
    expect(quit.host.quit).not.toHaveBeenCalled();
  });

  it('stops browser guests after saving and before Electron closes the windows', async () => {
    const quit = await at('stopping-guests');
    expect(quit.host.stopGuests).toHaveBeenCalledOnce();
    expect(quit.host.quit).not.toHaveBeenCalled();
    quit.stopped.resolve();
    await settle();
    expect(quit.sequence.phase()).toBe('closing-windows');
    expect(quit.host.quit).toHaveBeenCalledOnce();
    expect(quit.host.dispose).not.toHaveBeenCalled();
  });

  it('lets will-quit through without Desktop', async () => {
    const quit = await at('closing-windows');
    quit.host.dispose.mockReturnValue(undefined);
    const event = new TestEvent();
    quit.sequence.willQuit(event);
    expect(event.prevented).toBe(false);
    expect(quit.sequence.phase()).toBe('disposed');
    expect(quit.host.quit).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'quits after Desktop stops, even when stopping fails (%s)',
    async (fails) => {
      const quit = await at('disposing');
      const error = new Error('Desktop services failed to stop.');
      if (fails) quit.disposed.reject(error);
      else quit.disposed.resolve();
      await settle();
      expect(quit.sequence.phase()).toBe('disposed');
      expect(quit.host.quit).toHaveBeenCalledTimes(2);
      expect(quit.host.report).toHaveBeenCalledTimes(fails ? 1 : 0);
      if (fails) expect(quit.host.report).toHaveBeenCalledWith('Desktop shutdown failed', error);
    },
  );

  it('reports a will-quit before Quit saved, and stops the services all the same', async () => {
    const quit = await at('saving');
    quit.sequence.willQuit(new TestEvent());
    expect(quit.host.report).toHaveBeenCalledWith(
      'Viewer quit without saving first',
      expect.objectContaining({ message: 'At saving.' }),
    );
    expect(quit.host.dispose).toHaveBeenCalledOnce();
    quit.disposed.resolve();
    await settle();
    expect(quit.sequence.phase()).toBe('disposed');
    expect(quit.host.quit).toHaveBeenCalled();
  });

  it('closes the hotkey on every will-quit', async () => {
    const quit = await at('disposed');
    quit.sequence.willQuit(new TestEvent());
    expect(quit.host.closeHotkey).toHaveBeenCalledTimes(2);
    expect(quit.host.dispose).toHaveBeenCalledOnce();
  });

  it('exits headless straight to closing windows, with nothing to save', () => {
    const quit = fixture(0);
    quit.sequence.exitHeadless();
    quit.sequence.beforeQuit(new TestEvent());
    expect(quit.sequence.phase()).toBe('closing-windows');
    expect(quit.host.pendingOperations).not.toHaveBeenCalled();
    expect(quit.host.save).not.toHaveBeenCalled();
  });
});
