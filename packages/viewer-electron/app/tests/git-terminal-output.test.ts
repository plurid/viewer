import { describe, expect, it } from 'vitest';
import { TerminalOutputBudget } from '../src/desktop/terminals/terminal-output';

describe('Git terminal output budgets', () => {
  it('counts raw UTF-8 bytes regardless of renderer acknowledgements', () => {
    const output = new TerminalOutputBudget(6);
    expect(output.accept('éé')).toEqual({ data: 'éé', exceeded: false });
    expect(output.accept('abextra')).toEqual({ data: 'ab', exceeded: true });
    expect(output.accept('later')).toEqual({ data: '', exceeded: true });
  });

  it('makes read-only controls visible without executing terminal escape sequences', () => {
    const output = new TerminalOutputBudget(1024, true);
    const result = output.accept('file\tname\r\n\u001b]52;c;secret\u0007\u009b31m\u0000');
    expect(result.data).toBe('file\tname\r\n\\x1b]52;c;secret\\x07\\x9b31m\\x00');
    expect(result.exceeded).toBe(false);
  });

  it('keeps ordinary interactive shell output unchanged and unbounded', () => {
    const output = new TerminalOutputBudget();
    const chunk = '\u001b[31mred\u001b[0m'.repeat(100000);
    expect(output.accept(chunk)).toEqual({ data: chunk, exceeded: false });
  });
});
