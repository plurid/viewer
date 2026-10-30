/**
 * A file menu offers a few actions that fit its selection: Extract here for an archive, Optimize
 * for a large PDF. Rules name them; what a person keeps choosing for a kind of file raises or joins
 * them; only commands that apply are ever offered.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  rememberSuggestion,
  selectionKind,
  suggestionRules,
  type SuggestionInput,
} from '../src/domain/suggestions/rules';
import { contextMenuSections } from '../src/renderer/commands/menu';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import { rankSuggestions } from '../src/renderer/commands/suggestions';

const now = Date.UTC(2026, 9, 29);
const day = 24 * 60 * 60 * 1000;
const megabytes = 1_000_000;
const file = (name: string, size = 1000, parent = '/Users/a/Documents', extra = {}): FileEntry => {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mime =
    {
      jpg: 'image/jpeg',
      png: 'image/png',
      heic: 'image/heic',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
    }[extension] ?? 'application/octet-stream';
  return {
    path: parent + '/' + name,
    parent,
    name,
    extension,
    kind: 'file',
    directory: false,
    size,
    modified: now - day,
    created: now - day,
    hidden: false,
    mime,
    identity: name,
    ...extra,
  };
};
const folder = (name: string): FileEntry => ({
  ...file(name),
  extension: '',
  kind: 'directory',
  directory: true,
  mime: '',
});
const input = (selection: FileEntry[], extra: Partial<SuggestionInput> = {}): SuggestionInput => ({
  selection,
  now,
  home: '/Users/a',
  modelReady: false,
  editable: (entry) => ['md', 'txt', 'ts'].includes(entry.extension),
  ...extra,
});
/** The ids of the rules that apply, strongest first. */
const rules = (value: SuggestionInput) =>
  suggestionRules.filter((rule) => rule.reason(value)).map((rule) => rule.id);

describe('suggestion rules', () => {
  it.each([
    [[file('Photos.zip')], 'archive.extract'],
    [[file('backup.tar.gz')], 'archive.extract'],
    [[file('Scan.pdf', 18 * megabytes)], 'pdf.large.optimize'],
    [[file('IMG_1.heic')], 'heic.jpeg'],
    [[file('Beach.jpg', 6 * megabytes)], 'photo.large.web'],
    [[file('report copy.pdf')], 'names.copy'],
    [[file('report (2).pdf')], 'names.copy'],
    [[file('a.jpg'), file('b.jpg')], 'images.pdf'],
    [[file('clip.mp4')], 'media.edit'],
    [[file('voice.mp3')], 'media.edit'],
    [[file('notes.md')], 'text.edit'],
    [[file('Budget.xlsx'), file('Plan.odt')], 'office.pdf'],
    [[folder('Project')], 'folder.size'],
    [[folder('Project')], 'folder.explore', { modelReady: true }],
    [[file('a.pdf'), folder('b')], 'items.compress'],
  ])('%j suggests %s', (selection, rule, extra?: Partial<SuggestionInput>) => {
    expect(rules(input(selection as FileEntry[], extra))).toContain(rule);
  });

  it('gives a reason short enough to sit beside the action', () => {
    const reasons = suggestionRules
      .map((rule) => rule.reason(input([file('Scan.pdf', 18 * megabytes)])))
      .filter(Boolean);
    expect(reasons).toContain('18 MB PDF');
    for (const reason of reasons) expect(reason!.length).toBeLessThanOrEqual(32);
  });

  it('suggests trashing only old installers in Downloads', () => {
    const old = file('Setup.dmg', 1000, '/Users/a/Downloads', { modified: now - 12 * day });
    expect(rules(input([old]))).toContain('downloads.installer');
    expect(rules(input([{ ...old, modified: now - day }]))).not.toContain('downloads.installer');
    expect(rules(input([{ ...old, parent: '/Users/a/Desktop' }]))).not.toContain(
      'downloads.installer',
    );
  });

  it('offers a model recipe only once a model is set up', () => {
    expect(rules(input([file('Book.epub')]))).not.toContain('books.rename');
    expect(rules(input([file('Book.epub')], { modelReady: true }))).toContain('books.rename');
  });

  it('documents every rule by the id a person turns it off with', () => {
    const reference = readFileSync(
      fileURLToPath(new URL('../../../../docs/reference/configuration.md', import.meta.url)),
      'utf8',
    );
    for (const rule of suggestionRules) expect(reference).toContain('`' + rule.id + '`');
  });

  it('keeps small and ordinary files free of suggestions they do not need', () => {
    expect(rules(input([file('Scan.pdf', 2 * megabytes)]))).toEqual([]);
    expect(rules(input([file('Beach.jpg', megabytes)]))).toEqual([]);
  });
});

describe('ranking', () => {
  const command = (id: string): ResolvedCommand => ({
    id,
    label: id,
    group: 'Files',
    aliases: [],
    primary: false,
    source: 'folder:pane',
    context: { scope: 'files', workspaceID: 'w', selection: [], clipboard: null, jobs: [] },
  });
  const applicable = ['extract', 'compress', 'optimize-files', 'trash', 'rename'].map(command);
  const ids = (suggestions: { command: ResolvedCommand }[]) =>
    suggestions.map((item) => item.command.id);

  it('offers only commands that apply to the selection', () => {
    const big = [file('Scan.pdf', 18 * megabytes), file('copy (1).pdf')];
    // find-duplicates would apply by rule, but the folder does not offer it here
    expect(ids(rankSuggestions(applicable, input(big), []))).toEqual(['compress']);
  });

  it('raises what was chosen before for this kind, and lets a past choice join', () => {
    const archive = input([file('Photos.zip')]);
    expect(ids(rankSuggestions(applicable, archive, []))).toEqual(['extract']);
    const learned = rankSuggestions(applicable, archive, ['rename', 'trash']);
    expect(ids(learned)).toEqual(['extract', 'rename', 'trash']);
    expect(learned[1]!.reason).toBe('Your usual choice');
  });

  it('respects rules turned off, excluded commands and the limit', () => {
    const archive = input([file('Photos.zip')]);
    expect(
      ids(rankSuggestions(applicable, archive, [], { disabled: new Set(['archive.extract']) })),
    ).toEqual([]);
    expect(
      ids(rankSuggestions(applicable, archive, [], { exclude: new Set(['extract']) })),
    ).toEqual([]);
    expect(
      rankSuggestions(applicable, archive, ['rename', 'trash', 'compress'], { limit: 2 }),
    ).toHaveLength(2);
  });
});

describe('the model’s picks in ranking', () => {
  const command = (id: string): ResolvedCommand => ({
    id,
    label: id,
    group: 'Files',
    aliases: [],
    primary: false,
    source: 'folder:pane',
    context: { scope: 'files', workspaceID: 'w', selection: [], clipboard: null, jobs: [] },
  });
  const applicable = ['extract', 'compress', 'save-pdf-copy'].map(command);
  const model = {
    provider: 'Test model',
    picks: [
      { id: 'compress', reason: 'Smaller to send' },
      { id: 'missing', reason: 'Not applicable here' },
    ],
  };

  it('joins below a strong rule, labelled with the model, and only when it applies', () => {
    const ranked = rankSuggestions(applicable, input([file('Photos.zip')]), [], { model });
    expect(ranked.map((item) => [item.command.id, item.reason])).toEqual([
      ['extract', 'ZIP archive'],
      ['compress', 'Smaller to send · Test model'],
    ]);
  });

  it('raises a rule it agrees with, keeping the rule’s reason', () => {
    const two = input([file('a.pdf'), file('b.pdf')]);
    const ranked = rankSuggestions(applicable, two, [], { model });
    expect(ranked[0]).toMatchObject({ reason: '2 items' });
    expect(ranked[0]!.command.id).toBe('compress');
  });
});

describe('history', () => {
  it('keeps a kind per extension, family or mix', () => {
    expect(selectionKind([file('a.pdf'), file('b.pdf')])).toBe('pdf');
    expect(selectionKind([file('a.jpg'), file('b.png')])).toBe('family:image');
    expect(selectionKind([file('a.jpg'), file('b.pdf')])).toBe('mixed');
    expect(selectionKind([folder('Project')])).toBe('folder');
    expect(selectionKind([])).toBeUndefined();
  });

  it('puts the latest choice first and bounds what it keeps', () => {
    let history: Record<string, string[]> = {};
    for (const id of ['a', 'b', 'a']) history = rememberSuggestion(history, 'pdf', id);
    expect(history.pdf).toEqual(['a', 'b']);
    for (let index = 0; index < 12; index++)
      history = rememberSuggestion(history, 'pdf', 'id' + index);
    expect(history.pdf).toHaveLength(8);
    for (let index = 0; index < 50; index++)
      history = rememberSuggestion(history, 'kind' + index, 'x');
    expect(Object.keys(history)).toHaveLength(40);
  });
});

describe('the menu', () => {
  const command = (id: string, group = 'Files'): ResolvedCommand => ({
    id,
    label: id,
    group,
    aliases: [],
    primary: false,
    source: 'folder:pane',
    context: { scope: 'files', workspaceID: 'w', selection: [], clipboard: null, jobs: [] },
  });
  const commands = ['open-selection', 'extract', 'compress', 'rename', 'trash'].map((id) =>
    command(id),
  );

  it('places Suggested after Recent, with reasons, without repeating a recent row', () => {
    const sections = contextMenuSections(commands, ['rename', 'compress'], false, [
      { command: commands[1]!, reason: 'ZIP archive' },
      { command: commands[2]!, reason: '3 items' },
    ]);
    expect(sections.map((section) => section.label)).toEqual(
      expect.arrayContaining(['Recent', 'Suggested']),
    );
    expect(sections[0]!.label).toBe('Recent');
    expect(sections[1]!.label).toBe('Suggested');
    expect(sections[1]!.entries).toEqual([
      expect.objectContaining({ id: 'suggested.extract', note: 'ZIP archive' }),
    ]);
    const rows = sections.flatMap((section) => section.entries).map((entry) => entry.id);
    expect(new Set(rows).size).toBe(rows.length);
    // the suggested command keeps its own place too
    expect(rows).toContain('extract');
  });

  it('leaves Suggested out of an already scoped menu', () => {
    const sections = contextMenuSections(commands, [], true, [
      { command: commands[1]!, reason: 'ZIP archive' },
    ]);
    expect(sections.some((section) => section.label === 'Suggested')).toBe(false);
  });
});
