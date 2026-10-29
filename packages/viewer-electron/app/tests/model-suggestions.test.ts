// @vitest-environment jsdom
/**
 * With Let the model suggest actions on, the prompt model picks commands for the kinds of file in
 * a folder, once per folder. It sees names and the commands that apply, at the "names" level, and
 * only ids it was offered reach a menu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  defaultSettings,
  type ApplicationSettings,
  type ModelProvider,
} from '../src/domain/services';
import {
  modelPicks,
  modelSuggestionRequestSchema,
  type ModelSuggestionRequest,
} from '../src/domain/suggestions/model';
import { suggestWithModel } from '../src/desktop/models/prompts';
import { ModelPermissionRequired } from '../src/desktop/models/model-permissions';
import {
  askModelAboutFolder,
  forgetModelSuggestions,
  modelPicksFor,
  modelSuggestionRequest,
} from '../src/renderer/commands/model-suggestions';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import { flushState, getState, initialize, receiveSettings } from '../src/renderer/state/store';

const provider: ModelProvider = {
  id: 'p',
  name: 'Test model',
  kind: 'openai',
  endpoint: 'https://example.invalid/v1',
  model: 'test',
  allowContent: false,
};
const file = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: '/Users/a/Downloads/' + name,
  parent: '/Users/a/Downloads',
  name,
  extension: name.split('.').pop()!.toLowerCase(),
  kind: 'file',
  directory: false,
  size: 1000,
  modified: 0,
  created: 0,
  hidden: false,
  mime: '',
  identity: name,
  ...extra,
});
const command = (id: string, group = 'Quick actions'): ResolvedCommand => ({
  id,
  label: id,
  group,
  aliases: [],
  primary: false,
  source: 'folder:pane',
  context: { scope: 'files', workspaceID: 'w', selection: [], clipboard: null, jobs: [] },
});
const request: ModelSuggestionRequest = {
  folder: 'Downloads',
  kinds: [
    {
      kind: 'pdf',
      count: 3,
      names: ['Scan.pdf'],
      commands: [
        { id: 'optimize-files', label: 'Optimize…' },
        { id: 'compress', label: 'Compress' },
      ],
    },
  ],
};

describe('the model’s picks', () => {
  it('keeps only ids offered for the kind, two at most, once each, with short reasons', () => {
    expect(
      modelPicks(request, {
        kinds: [
          {
            kind: 'pdf',
            commands: [
              { id: 'trash', reason: 'Not offered' },
              { id: 'optimize-files', reason: '  Scans   are large ' },
              { id: 'optimize-files', reason: 'Again' },
              { id: 'compress', reason: 'x'.repeat(100) },
            ],
          },
          { kind: 'zip', commands: [{ id: 'extract', reason: 'Kind not asked about' }] },
        ],
      }),
    ).toEqual({
      pdf: [
        { id: 'optimize-files', reason: 'Scans are large' },
        { id: 'compress', reason: 'x'.repeat(60) },
      ],
    });
  });

  it('asks at the names level and validates the answer', async () => {
    const settings: ApplicationSettings = {
      ...defaultSettings('/Users/a'),
      providers: [provider],
    };
    settings.browsing.modelSuggestions = true;
    const generate = vi.fn(async () => ({
      kinds: [{ kind: 'pdf', commands: [{ id: 'compress', reason: 'Smaller to send' }] }],
    }));
    const signal = new AbortController().signal;
    await expect(suggestWithModel(request, settings, generate, signal)).resolves.toEqual({
      provider: 'Test model',
      picks: { pdf: [{ id: 'compress', reason: 'Smaller to send' }] },
    });
    expect(generate).toHaveBeenCalledWith(
      provider,
      expect.any(String),
      request,
      expect.any(Object),
      signal,
      'names',
      'user',
    );
    generate.mockResolvedValueOnce({ kinds: 'none' } as never);
    await expect(suggestWithModel(request, settings, generate, signal)).rejects.toThrow(/invalid/);
    generate.mockRejectedValueOnce(new ModelPermissionRequired());
    await expect(suggestWithModel(request, settings, generate, signal)).rejects.toThrow(
      /Settings → Models/,
    );
  });

  it('never asks when the setting is off or no model is set up', async () => {
    const generate = vi.fn();
    const signal = new AbortController().signal;
    const off = { ...defaultSettings('/Users/a'), providers: [provider] };
    await expect(suggestWithModel(request, off, generate, signal)).rejects.toThrow(/Turn on/);
    const none = defaultSettings('/Users/a');
    none.browsing.modelSuggestions = true;
    await expect(suggestWithModel(request, none, generate, signal)).rejects.toThrow(/Add a model/);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('asking about a folder', () => {
  beforeEach(() => {
    forgetModelSuggestions();
    Object.assign(window, { viewer: { save: vi.fn(async () => {}), modelSuggestions: vi.fn() } });
    initialize({ home: '/Users/a', platform: 'darwin', state: null, locations: [], openPaths: [] });
  });
  afterEach(async () => {
    await flushState(false);
  });
  const allow = (modelSuggestions: boolean) => {
    const current = getState().settings;
    receiveSettings({
      ...current,
      revision: current.revision + 1,
      settings: {
        ...current.settings,
        providers: [provider],
        browsing: { ...current.settings.browsing, modelSuggestions },
      },
    });
  };
  const applicable = () => [
    command('optimize-files', 'Files'),
    command('compress', 'Files'),
    command('rename', 'Files'),
    command('trash', 'Files'),
    command('save-pdf-copy'),
  ];

  it('sends the folder’s name, its commonest kinds, a few names and only file actions', () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, index) => file(`Scan ${index}.pdf`)),
      file('Setup.dmg'),
      file('.hidden.pdf', { hidden: true }),
    ];
    const built = modelSuggestionRequest('/Users/a/Downloads', entries, applicable)!;
    expect(modelSuggestionRequestSchema.safeParse(built).success).toBe(true);
    expect(built.folder).toBe('Downloads');
    expect(built.kinds.map((kind) => [kind.kind, kind.count])).toEqual([
      ['pdf', 10],
      ['dmg', 1],
    ]);
    expect(built.kinds[0]!.names).toHaveLength(8);
    expect(built.kinds[0]!.names).not.toContain('.hidden.pdf');
    // navigation, renaming and Trash stay with the person
    expect(built.kinds[0]!.commands.map((item) => item.id)).toEqual([
      'optimize-files',
      'compress',
      'save-pdf-copy',
    ]);
    const many = Array.from({ length: 20 }, (_, index) => file(`a.x${index}`));
    expect(modelSuggestionRequest('/f', many, applicable)!.kinds).toHaveLength(12);
  });

  it('asks once per folder, keeps the answer for menus and never asks while off', async () => {
    const entries = [file('Scan.pdf')];
    askModelAboutFolder('/Users/a/Downloads', entries, applicable);
    expect(window.viewer.modelSuggestions).not.toHaveBeenCalled();
    allow(true);
    vi.mocked(window.viewer.modelSuggestions).mockResolvedValue({
      provider: 'Test model',
      picks: { pdf: [{ id: 'save-pdf-copy', reason: 'Opens anywhere' }] },
    });
    askModelAboutFolder('/Users/a/Downloads', entries, applicable);
    askModelAboutFolder('/Users/a/Downloads', entries, applicable);
    expect(window.viewer.modelSuggestions).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(modelPicksFor('/Users/a/Downloads', 'pdf')).toEqual({
        provider: 'Test model',
        picks: [{ id: 'save-pdf-copy', reason: 'Opens anywhere' }],
      }),
    );
    expect(modelPicksFor('/Users/a/Downloads', 'dmg')).toBeUndefined();
  });

  it('keeps a refusal for the session instead of asking on every visit', async () => {
    allow(true);
    vi.mocked(window.viewer.modelSuggestions).mockRejectedValue(new Error('Allow names'));
    askModelAboutFolder('/f', [file('Scan.pdf')], applicable);
    await Promise.resolve();
    askModelAboutFolder('/f', [file('Scan.pdf')], applicable);
    expect(window.viewer.modelSuggestions).toHaveBeenCalledOnce();
    expect(modelPicksFor('/f', 'pdf')).toBeUndefined();
  });
});
