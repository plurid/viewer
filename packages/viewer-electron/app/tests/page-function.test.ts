import { runInNewContext } from 'node:vm';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { NativeScenarioHarness } from './native/runtime/harness';
import type { PageExpression } from './native/runtime/page-function';
import { pageCall } from './native/runtime/page-function';

// tsx keeps the names of nested functions through this helper; Vitest's transform does not, so the
// fixture calls it itself, as tsx output would.
declare const __name: <T>(target: T, name: string) => T;

function total(values: number[], offset: number) {
  const add = __name((sum: number, value: number) => sum + value, 'add');
  return values.reduce(add, offset);
}

const later = async (label: string) => {
  await Promise.resolve();
  return label + ' ready';
};

/** A harness whose page is a fresh context, as CDP evaluates an expression in the renderer. */
const page: NativeScenarioHarness = {
  evaluate: async (expression: string) => runInNewContext(expression),
  command: () => Promise.reject(new Error('No CDP in this test')),
  until: async (read) => read(),
};

describe('pageCall', () => {
  it('defines the __name helper that tsx output calls', () => {
    expect(() => runInNewContext(`(${total.toString()})([1], 0)`)).toThrow(/__name/);
    expect(runInNewContext(pageCall(total, [1, 2, 3], 4))).toBe(10);
  });

  it('passes arguments as JSON, so undefined arrives as null', () => {
    const echo = (...values: unknown[]) => values;
    const text = 'a "quoted" \\ line\n';
    const values = runInNewContext(pageCall(echo, text, { list: [1, 2] }, undefined));
    expect(JSON.parse(JSON.stringify(values))).toEqual([text, { list: [1, 2] }, null]);
  });

  it('evaluates to what an async function resolves to, typed', async () => {
    const value = page.evaluate(pageCall(later, 'Preview'));
    expectTypeOf(pageCall(later, 'Preview')).toEqualTypeOf<PageExpression<Promise<string>>>();
    expectTypeOf(value).toEqualTypeOf<Promise<string>>();
    expect(await value).toBe('Preview ready');
  });
});
