import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { AwakeClock, nativeAwakeReading, QualificationInterrupted } from './awake-clock';

describe('release qualification awake time', () => {
  it('counts the entire awake duration through the final sample', () => {
    let now = { awakeMs: 10000, wallMs: 20000 };
    const clock = new AwakeClock(() => now);
    now = { awakeMs: 10000 + 120 * 60000, wallMs: 20000 + 120 * 60000 };
    expect(clock.elapsed()).toEqual({ awakeMs: 120 * 60000, wallMs: 120 * 60000 });
  });
  it('refuses to count a long lid closure as a completed interval', () => {
    let now = { awakeMs: 10000, wallMs: 20000 };
    const clock = new AwakeClock(() => now);
    now = { awakeMs: 12000, wallMs: 20000 + 120 * 60000 };
    expect(() => clock.elapsed()).toThrow(QualificationInterrupted);
  });
  it('allows bounded clock-reading jitter', () => {
    let now = { awakeMs: 10000, wallMs: 20000 };
    const clock = new AwakeClock(() => now);
    now = { awakeMs: 11000, wallMs: 21200 };
    expect(clock.elapsed().awakeMs).toBe(1000);
  });
  it('rejects backward time rather than extending or completing the run', () => {
    let now = { awakeMs: 10000, wallMs: 20000 };
    const clock = new AwakeClock(() => now);
    now = { awakeMs: 12000, wallMs: 22000 };
    clock.elapsed();
    now = { awakeMs: 11999, wallMs: 23000 };
    expect(() => clock.elapsed()).toThrow(QualificationInterrupted);
  });
  it.skipIf(process.platform !== 'darwin')(
    'reads an advancing native macOS awake clock',
    async () => {
      const before = nativeAwakeReading();
      await delay(20);
      const after = nativeAwakeReading();
      expect(after.awakeMs).toBeGreaterThan(before.awakeMs + 10);
      expect(
        Math.abs(after.wallMs - before.wallMs - (after.awakeMs - before.awakeMs)),
      ).toBeLessThan(1000);
    },
  );
});
