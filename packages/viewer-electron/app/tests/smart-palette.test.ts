/**
 * THE SMART PALETTE (2026-10-23): typing a path offers its folder's contents; `=` calculates; `z`
 * and a name jumps to a folder by frecency, as zoxide does; and a command can take its argument
 * typed after its name: `new folder Drafts`, `rename notes.md`, `go ~/Downloads`.
 */
import { describe, expect, it } from 'vitest';
import {
  calculate,
  frecencyScore,
  paletteIntent,
  rankFrecent,
  recordVisit,
} from '../src/renderer/commands/smart-palette';

describe('what a query asks for', () => {
  const intent = (query: string) => paletteIntent(query, '/Users/me', '/Users/me/project');
  it('reads a path, from the root, home or the current folder', () => {
    expect(intent('/Applications/Sa')).toEqual({
      kind: 'path',
      directory: '/Applications',
      partial: 'Sa',
    });
    expect(intent('~/Down')).toEqual({ kind: 'path', directory: '/Users/me', partial: 'Down' });
    expect(intent('~')).toEqual({ kind: 'path', directory: '/Users/me', partial: '' });
    expect(intent('./src/')).toEqual({
      kind: 'path',
      directory: '/Users/me/project/src',
      partial: '',
    });
    expect(intent('../')).toEqual({ kind: 'path', directory: '/Users/me', partial: '' });
  });
  it('reads a calculation, a jump and a command with its argument', () => {
    expect(intent('= 2 * (3 + 4)')).toEqual({ kind: 'calc', expression: '2 * (3 + 4)' });
    expect(intent('z dow')).toEqual({ kind: 'jump', text: 'dow' });
    expect(intent('new folder Drafts 2026')).toEqual({
      kind: 'argument',
      command: 'new-folder',
      text: 'Drafts 2026',
    });
    expect(intent('rename notes.md')).toEqual({
      kind: 'argument',
      command: 'rename',
      text: 'notes.md',
    });
    expect(intent('mkdir build')).toMatchObject({ command: 'new-folder', text: 'build' });
    expect(intent('cd ~/Downloads')).toMatchObject({
      command: 'go-to',
      text: '/Users/me/Downloads',
    });
    expect(intent('frame plane')).toBeNull();
  });
});

describe('the calculator', () => {
  it('evaluates arithmetic with precedence, powers and a few functions', () => {
    expect(calculate('2 * (3 + 4)')).toBe(14);
    expect(calculate('2^10 - 24')).toBe(1000);
    expect(calculate('-3 + 10 % 4')).toBe(-1);
    expect(calculate('sqrt(16) + abs(-2) + round(2.6)')).toBe(9);
    expect(calculate('1.5e3 / 3')).toBe(500);
    expect(calculate('pi')).toBeCloseTo(Math.PI);
  });
  it('refuses anything that is not arithmetic', () => {
    for (const expression of ['', '2 +', 'alert(1)', 'process.exit()', '(1', '1)', '2 ** 3 ** x'])
      expect(calculate(expression), expression).toBeUndefined();
  });
});

describe('frecency', () => {
  const now = Date.UTC(2026, 9, 23, 12);
  const hour = 3600_000;
  it('ranks by how often and how lately, as zoxide', () => {
    expect(frecencyScore({ count: 10, last: now - hour / 2 }, now)).toBeGreaterThan(
      frecencyScore({ count: 10, last: now - 30 * 24 * hour }, now),
    );
    const visits = {
      '/Users/me/Downloads': { count: 20, last: now - 2 * hour },
      '/Users/me/Documents/downloads-old': { count: 2, last: now - 90 * 24 * hour },
      '/Users/me/project': { count: 50, last: now },
    };
    expect(rankFrecent(visits, 'dow', now)).toEqual([
      '/Users/me/Downloads',
      '/Users/me/Documents/downloads-old',
    ]);
    expect(rankFrecent(visits, 'me proj', now)).toEqual(['/Users/me/project']);
  });
  it('counts a visit, keeping the 500 most frecent', () => {
    let visits = {};
    for (let index = 0; index < 510; index++)
      visits = recordVisit(visits, `/f/${index}`, now + index);
    expect(Object.keys(visits)).toHaveLength(500);
    visits = recordVisit(visits, '/f/509', now + 600);
    expect(visits['/f/509' as keyof typeof visits]).toEqual({ count: 2, last: now + 600 });
  });
});
