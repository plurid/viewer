import { expect, it, vi } from 'vitest';
import {
  exportPresetAvailable,
  exportPresetCatalog,
  imagePresetPlan,
  pdfEmailPreset,
} from '../src/domain/operations/export-presets';
import type { FileEntry } from '../src/domain/contracts';
import { programCommands } from '../src/renderer/commands/programs';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type { CommandContext } from '../src/renderer/commands/registry';
import { initialize } from '../src/renderer/state/store';
const file = (extension: string): FileEntry => ({
  path: '/fixture/source.' + extension,
  parent: '/fixture',
  name: 'source.' + extension,
  extension,
  kind: 'file',
  directory: false,
  size: 100,
  identity: extension,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'application/octet-stream',
});
it('uses contextual typed presets with explicit quality/dimension limits', () => {
  expect(imagePresetPlan('images-for-web')).toMatchObject({
    format: 'webp',
    quality: 80,
    width: 2048,
    height: 2048,
    metadata: 'safe',
  });
  expect(imagePresetPlan('batch-convert').width).toBeUndefined();
  expect(pdfEmailPreset).toEqual({ preset: 'small', recompressImages: true, maximum: 1600 });
  for (const preset of exportPresetCatalog) {
    expect(exportPresetAvailable(preset, [])).toBe(false);
    expect(exportPresetAvailable(preset, [file('exe')])).toBe(false);
  }
  expect(exportPresetAvailable(exportPresetCatalog[0], [file('JPG')])).toBe(true);
  expect(exportPresetAvailable(exportPresetCatalog[1], [file('png')])).toBe(false);
  expect(exportPresetAvailable(exportPresetCatalog[1], [file('png'), file('jpg')])).toBe(true);
  expect(exportPresetAvailable(exportPresetCatalog[2], [file('pdf')])).toBe(true);
  expect(exportPresetAvailable(exportPresetCatalog[3], [file('mp4')])).toBe(true);
});
it('opens review surfaces with a captured selection and creates a fresh audio draft', async () => {
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const imageTools = vi.fn(),
    optimizeFiles = vi.fn(),
    openMedia = vi.fn(async () => {});
  const commands = programCommands(
    { openMedia } as unknown as WorkspaceController,
    async () => false,
    undefined,
    undefined,
    undefined,
    { imageTools, optimizeFiles },
  );
  const context: CommandContext = {
    paneID: 'origin',
    directory: '/fixture',
    selection: [file('png')],
    scope: 'folder',
    workspaceID: 'space',
    clipboard: { paths: [], cut: false },
    jobs: [],
  };
  commands.find((command) => command.id === 'export.images-for-web')!.run(context);
  context.selection[0]!.name = 'later.png';
  expect(imageTools.mock.calls[0]![0][0].name).toBe('source.png');
  expect(imageTools.mock.calls[0]!.slice(1)).toEqual(['origin', 'images-for-web']);
  await commands
    .find((command) => command.id === 'export.extract-audio')!
    .run({ ...context, selection: [file('mp4')] });
  expect(openMedia).toHaveBeenCalledWith(['/fixture/source.mp4'], 'origin', true, 'extract-audio');
});
