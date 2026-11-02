import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { repairReplayClock } from '../tools/robotics/replay-clock';

// The retained canvas starts its clock in a click handler, before the first queued frame arrives.
const clock = `
let replayLast = 0, replayCursor = 0;
function playReplay() {
  replayLast = performance.now();
  return function (t) {
    const dt = (t - replayLast) / 1000;
    replayLast = t;
    replayCursor = Math.min(1, replayCursor + dt * 0.6);
    return replayCursor;
  };
}
const frame = playReplay();
[100, 116.67, 500, 1000, 2000].map(frame);
`;

describe('retained robot replay clock', () => {
  it('keeps an earlier first-frame timestamp inside the saved pose sequence', () => {
    const environment = { performance: { now: () => 100.5 } };
    const original: number[] = vm.runInNewContext(clock, { ...environment });
    expect(original[0]).toBeLessThan(0);
    const repair = repairReplayClock(clock);
    const positions: number[] = vm.runInNewContext(repair.html, { ...environment });
    expect(repair.repaired).toBe(true);
    expect(positions[0]).toBe(0);
    expect(positions.every((position) => position >= 0 && position <= 1)).toBe(true);
    expect(positions.at(-1)).toBe(1);
  });

  it('preserves forward elapsed time and does not apply the repair twice', () => {
    const environment = { performance: { now: () => 90 } };
    const repair = repairReplayClock(clock);
    expect(vm.runInNewContext(repair.html, { ...environment })).toEqual(
      vm.runInNewContext(clock, { ...environment }),
    );
    expect(repairReplayClock(repair.html)).toEqual({ html: repair.html, repaired: false });
  });

  it('leaves inspectors alone and refuses an unrecognized player', () => {
    expect(repairReplayClock('<h1>Inspector</h1>')).toEqual({
      html: '<h1>Inspector</h1>',
      repaired: false,
    });
    expect(() => repairReplayClock('function playReplay() {}')).toThrow('reviewed repair');
  });
});
