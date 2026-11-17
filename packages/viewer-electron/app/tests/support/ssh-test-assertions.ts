import assert from 'node:assert/strict';

export function afterEach(_work: () => unknown): void {}
export function expect(value: unknown) {
  return {
    toEqual(expected: unknown) {
      assert.deepEqual(value, expected);
    },
    toContain(expected: unknown) {
      assert.ok((value as unknown[]).includes(expected));
    },
    not: {
      toContain(expected: unknown) {
        assert.ok(!(value as unknown[]).includes(expected));
      },
    },
  };
}
