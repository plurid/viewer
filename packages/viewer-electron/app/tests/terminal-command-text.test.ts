import { describe, expect, it } from 'vitest';
import { validTerminalCommand } from '../src/domain/terminals/command-text';

describe('literal terminal command text', () => {
  it.each([
    'npm run dev',
    'echo "a && b"',
    'echo café',
    'echo 日本語',
    'echo 🚀',
    'x'.repeat(1000),
  ])('accepts visible shell text %j', (value) => {
    expect(validTerminalCommand(value)).toBe(true);
  });

  it.each([
    '',
    'x'.repeat(1001),
    'npm\trun dev',
    'echo\u202e',
    'echo\u2066',
    'echo\u2067',
    'echo\u2068',
    'echo\u2069',
    'echo\u200b',
    'echo\ufeff',
    'echo\u00ad',
    'echo\ud800',
    'echo\udfff',
    'echo\u2028next',
    'echo\u2029next',
    null,
    undefined,
    7,
  ])('refuses invisible, malformed or oversized text %j', (value) => {
    expect(validTerminalCommand(value)).toBe(false);
  });

  it('refuses every C0, DEL and C1 character, including typed tab completion', () => {
    const codes = [
      ...Array.from({ length: 32 }, (_, index) => index),
      ...Array.from({ length: 33 }, (_, index) => index + 127),
    ];
    for (const code of codes)
      expect(validTerminalCommand('echo ' + String.fromCharCode(code)), `control ${code}`).toBe(
        false,
      );
  });
});
