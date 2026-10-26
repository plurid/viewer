/**
 * THE COMMAND LINE'S LANGUAGE: lines of steps as vim's ex lines and tmux's commands
 * are; verbs by vim's names and tmux's; `set` by fixed setting names.
 */
import { describe, expect, it } from 'vitest';
import {
  expandPath,
  LineError,
  parseLine,
  quoteWord,
  type Word,
} from '../src/domain/command-line/lex';
import {
  bindStep,
  didYouMean,
  findVerb,
  parseCommandLine,
  resolveName,
  verbForms,
  verbs,
} from '../src/domain/command-line/verbs';
import { parseSet, settingByName, settingNames, settingText } from '../src/domain/command-line/set';
import { defaultKeymap, bindingRows } from '../src/domain/preferences/keymap';
import { settingCatalog } from '../src/domain/preferences/catalog';

const failsAt = (run: () => unknown, at: number, message?: RegExp) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LineError);
    expect((error as LineError).at).toBe(at);
    if (message) expect((error as LineError).message).toMatch(message);
    return;
  }
  throw new Error('It parsed.');
};
const word = (text: string, quoted = false): Word => ({ text, quoted, at: 0, end: text.length });

describe('a line', () => {
  it('is every command id as it is: saved bindings and sequences are lines already', () => {
    const ids = [
      ...bindingRows(defaultKeymap.bindings)
        .flatMap((row) => row.commands)
        .filter((line) => !line.includes(' ')),
      'setting.ui.space.grid=false',
      'setting.ui.space.minimap@workspace',
      'workspace:3f2a',
      'bookmark.save.1',
      'custom.macro-x-1',
      'tile-layout-even-horizontal',
    ];
    for (const id of ids) {
      const steps = parseLine(id);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ name: id, bang: false, words: [] });
    }
  });
  it('is steps with counts, ! and words, quoted or escaped, after | or ;', () => {
    const steps = parseLine(`3vs ~/a | q! ; e 'my file.md' "say \\"hi\\"" a\\ b`);
    expect(steps.map((step) => [step.count, step.name, step.bang])).toEqual([
      [3, 'vs', false],
      [undefined, 'q', true],
      [undefined, 'e', false],
    ]);
    expect(steps[0]!.words.map((item) => item.text)).toEqual(['~/a']);
    expect(steps[2]!.words.map((item) => [item.text, item.quoted])).toEqual([
      ['my file.md', true],
      ['say "hi"', true],
      ['a b', false],
    ]);
    // a leading colon, as vim users write lines; a count may stand apart
    expect(parseLine(':3 focus-right')[0]).toMatchObject({ count: 3, name: 'focus-right' });
    expect(parseLine('')).toEqual([]);
    expect(parseLine(' | q |')).toHaveLength(1);
  });
  it('says where it does not parse', () => {
    failsAt(() => parseLine(`e 'open`), 2, /quote/);
    failsAt(() => parseLine('q | "x"'), 4, /name/);
    failsAt(() => parseLine('3'), 1, /count needs/);
    failsAt(() => parseLine('100q'), 0, /count/);
    failsAt(() => parseLine('q?'), 1, /cannot follow/);
    failsAt(() => parseLine('x'.repeat(501)), 500, /500/);
    failsAt(() => parseLine(Array(51).fill('q').join('|')), 100, /50 steps/);
  });
  it('gives a verb that takes a line its words with | in them, and the rest as typed', () => {
    const [step] = parseCommandLine('bind -n M-h vs | e ~');
    expect(step!.words.map((item) => item.text)).toEqual(['-n', 'M-h', 'vs', '|', 'e', '~']);
    expect(step!.rest).toEqual({ text: '-n M-h vs | e ~', at: 5 });
    expect(parseCommandLine('vs | e ~')).toHaveLength(2);
  });
  it('writes words back as a line needs them', () => {
    for (const text of ['plain', 'two words', "it's", 'a|b', '~/x', '"quoted"']) {
      const [step] = parseLine(`e ${quoteWord(text)}`);
      expect(step!.words[0]!.text).toBe(text);
    }
  });
  it('expands ~, % and %:h in paths, never in quotes', () => {
    const places = { home: '/Users/me', folder: '/Users/me/Docs', current: '/Users/me/Docs/a.md' };
    expect(expandPath(word('~/x'), places)).toBe('/Users/me/x');
    expect(expandPath(word('%'), places)).toBe('/Users/me/Docs/a.md');
    expect(expandPath(word('%:h/b.md'), places)).toBe('/Users/me/Docs/b.md');
    expect(expandPath(word('../y'), places)).toBe('/Users/me/y');
    expect(expandPath(word('~', true), places)).toBe('/Users/me/Docs/~');
  });
});

describe('the verbs', () => {
  it('answer each to its own names: no form is two verbs’', () => {
    const owner = new Map<string, string>();
    for (const verb of verbs)
      for (const form of verbForms(verb)) {
        expect(owner.get(form), `${form}: ${verb.key} and ${owner.get(form)}`).toBeUndefined();
        owner.set(form, verb.key);
      }
    expect(findVerb('q')?.key).toBe('quit');
    expect(findVerb('qui')?.key).toBe('quit');
    expect(findVerb('qa')?.key).toBe('qall');
    expect(findVerb('tabne')?.key).toBe('tabnext');
    expect(findVerb('tabnew')?.key).toBe('tabnew');
    expect(findVerb('kill-pane')?.key).toBe('quit');
    expect(findVerb('split-window')?.key).toBe('split-window');
    expect(findVerb('setl')?.key).toBe('setlocal');
    expect(findVerb('se')?.key).toBe('set');
  });
  it('resolve names: a capital is the person’s command, a verb, else a command id', () => {
    expect(resolveName('Dev')).toEqual({ kind: 'user', name: 'Dev' });
    expect(resolveName('vs')).toMatchObject({ kind: 'verb', verb: { key: 'vsplit' } });
    expect(resolveName('tile-split-right')).toEqual({ kind: 'id', id: 'tile-split-right' });
  });
  it('check flags, words and !', () => {
    const bound = (line: string) => {
      const [step] = parseCommandLine(line);
      return bindStep(
        step!,
        resolveName(step!.name).kind === 'verb' ? findVerb(step!.name)! : verbs[0]!,
      );
    };
    expect(bound('split-window -h')).toEqual({ flags: { h: true }, args: [] });
    expect(bound('select-window -t Studio').flags).toEqual({ t: 'Studio' });
    expect(bound('resize-pane -R 3').args.map((item) => item.text)).toEqual(['3']);
    failsAt(() => bound('split-window -x'), 13, /no -x/);
    failsAt(() => bound('tabp x'), 5, /takes no words/);
    // one name takes every word left
    expect(bound('w my notes.md').args.map((item) => item.text)).toEqual(['my notes.md']);
    failsAt(() => bound('e'), 0, /needs/);
    failsAt(() => bound('wa!'), 0, /does not take !/);
    expect(bound('q!')).toEqual({ flags: {}, args: [] });
  });
  it('suggest the name meant', () => {
    expect(didYouMean('vsp', ['vs', 'vsplit', 'split'])).toBe('vs');
    expect(didYouMean('tile-splt-right', ['tile-split-right', 'tile-split-down'])).toBe(
      'tile-split-right',
    );
    expect(didYouMean('zzz', ['vs'])).toBeUndefined();
  });
});

describe('set', () => {
  it('names settings that exist, each by one path, frozen', () => {
    for (const [name, path] of Object.entries(settingNames))
      expect(settingByName(name)?.path, name).toBe(path);
    // names saved in lines keep their meaning: renaming one is a breaking change
    expect(Object.keys(settingNames).sort()).toMatchSnapshot();
    expect(settingByName('ui.space.grid')?.path).toBe('ui.space.grid');
    expect(settingCatalog.length).toBeGreaterThan(Object.keys(settingNames).length / 2);
  });
  it('reads vim’s forms', () => {
    const ops = parseSet(
      [
        'grid',
        'nogrid',
        'grid!',
        'invgrid',
        'grid?',
        'grid&',
        'opacity=60',
        'opacity+=10',
        'backdrop=Blur',
        'color=#ABC',
        'opacity',
      ].map((text) => word(text)),
    );
    expect(
      ops.map((op) => [
        op.definition.path.split('.').pop(),
        op.op,
        'value' in op ? op.value : undefined,
      ]),
    ).toEqual([
      ['grid', 'on', undefined],
      ['grid', 'off', undefined],
      ['grid', 'toggle', undefined],
      ['grid', 'toggle', undefined],
      ['grid', 'show', undefined],
      ['grid', 'default', undefined],
      ['backdropOpacity', 'value', 60],
      ['backdropOpacity', 'add', 10],
      ['backdrop', 'value', 'blur'],
      ['color', 'value', '#aabbcc'],
      // a number named alone shows it, as vim does
      ['backdropOpacity', 'show', undefined],
    ]);
  });
  it('refuses what a setting cannot be', () => {
    failsAt(() => parseSet([word('opacity=200')]), 0, /at most 100/);
    failsAt(() => parseSet([word('backdrop=red')]), 0, /one of opaque, blur, clear/);
    failsAt(() => parseSet([word('opacity!')]), 0, /toggles on\/off/);
    failsAt(() => parseSet([word('noopacity')]), 0, /on\/off settings/);
    failsAt(() => parseSet([word('nothing')]), 0, /No setting/);
    failsAt(() => parseSet([word('grid=maybe')]), 0, /on or off/);
  });
  it('shows a value as :set name? does', () => {
    expect(settingText(settingByName('grid')!, false)).toBe('nogrid');
    expect(settingText(settingByName('opacity')!, 60)).toBe('opacity=60');
    expect(settingText(settingByName('color')!, '')).toBe('color=auto');
  });
});
