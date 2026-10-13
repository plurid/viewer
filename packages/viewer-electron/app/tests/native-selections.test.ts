import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NativeSelections } from '../src/desktop/native-selections';

const root = path.resolve('/selection'),
  file = path.join(root, 'Generated.txt');
describe('native selection revocation', () => {
  it('rejects repeated clipboard and drag imports until a new native selection arrives', () => {
    const versions = { clipboard: 7, drag: 19 };
    const selections = new NativeSelections((source) => versions[source]);
    selections.revoke(root);
    for (const source of ['clipboard', 'drag'] as const) {
      const old = selections.capture(source, versions[source]);
      expect(() => selections.assertImport([file], old)).toThrow();
      versions[source]++;
      const fresh = selections.capture(source, versions[source]);
      expect(() => selections.assertImport([file], fresh)).not.toThrow();
    }
  });
  it('does not widen a sibling denial or confuse clipboard and drag generations', () => {
    const versions = { clipboard: 7, drag: 19 };
    const selections = new NativeSelections((source) => versions[source]);
    selections.revoke(root);
    const sibling = path.resolve('/selection-other/Generated.txt');
    expect(() =>
      selections.assertImport([sibling], selections.capture('clipboard', 7)),
    ).not.toThrow();
    versions.drag++;
    expect(() => selections.assertImport([file], selections.capture('drag', 20))).not.toThrow();
    expect(() => selections.assertImport([file], selections.capture('clipboard', 7))).toThrow();
  });
  it('rejects imports captured before a revoke even after a fresh copy', () => {
    const versions = { clipboard: 7, drag: 19 };
    const selections = new NativeSelections((source) => versions[source]);
    const pending = selections.capture('clipboard', 7);
    selections.revoke(root);
    versions.clipboard++;
    const fresh = selections.capture('clipboard', 8);
    expect(() => selections.assertImport([file], fresh)).not.toThrow();
    expect(() => selections.assertImport([file], pending)).toThrow();
  });
  it('keeps an old revoked board blocked when a later reader sees a new copy', () => {
    const versions = { clipboard: 7, drag: 19 };
    const selections = new NativeSelections((source) => versions[source]);
    selections.revoke(root);
    const pending = selections.capture('clipboard', 7);
    versions.clipboard++;
    const fresh = selections.capture('clipboard', 8);
    expect(() => selections.assertImport([file], fresh)).not.toThrow();
    expect(() => selections.assertImport([file], pending)).toThrow();
  });
  it('retains all same-board revocations while allowing unrelated files', () => {
    const selections = new NativeSelections(() => 7);
    const other = path.resolve('/another-selection');
    selections.revoke(root);
    selections.revoke(other);
    const selection = selections.capture('clipboard', 7);
    for (const target of [file, path.join(other, 'Second.txt')])
      expect(() => selections.assertImport([target], selection)).toThrow();
    expect(() =>
      selections.assertImport([path.resolve('/unrelated/File.txt')], selection),
    ).not.toThrow();
  });
  it('handles a filesystem-root revocation without a sibling-prefix escape', () => {
    const selections = new NativeSelections(() => 7);
    selections.revoke(path.parse(root).root);
    expect(() => selections.assertImport([file], selections.capture('clipboard', 7))).toThrow();
  });
  it('fails closed when the revocation version cannot be read', () => {
    let unavailable = true;
    const selections = new NativeSelections(() => {
      if (unavailable) throw new Error('Native version unavailable');
      return 7;
    });
    selections.revoke(root);
    unavailable = false;
    selections.revoke(path.resolve('/another-selection'));
    expect(() => selections.assertImport([file], selections.capture('clipboard', 7))).toThrow();
    expect(() => selections.assertImport([file], selections.capture('clipboard', 8))).toThrow();
  });
});
