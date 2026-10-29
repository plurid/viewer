import { z } from 'zod';
import { portablePath as localPath } from '../../schemas';
import { tileLayouts } from '../../workspaces/tiling';

export const appearanceSchema = z.enum(['system', 'dark', 'light']);
export const themeChoiceSchema = z
  .object({
    dark: z.string().max(100).default(''),
    light: z.string().max(100).default(''),
  })
  .strict()
  .default({ dark: '', light: '' });

export const browsingSchema = z
  .object({
    mode: z.enum(['list', 'grid', 'columns', 'gallery']),
    sort: z.enum(['name', 'modified', 'created', 'kind', 'extension', 'size']).default('name'),
    descending: z.boolean().default(false),
    group: z.enum(['none', 'kind', 'modified']).default('none'),
    columnWidth: z.number().int().min(160).max(1600).default(280),
    density: z.enum(['comfortable', 'compact']),
    scrollbars: z.enum(['system', 'always']).default('system'),
    foldersFirst: z.boolean(),
    showHidden: z.boolean(),
    restoreSession: z.boolean(),
    confirmTrash: z.boolean().default(true),
    suggestions: z.boolean().default(true),
    // rule ids from domain/suggestions/rules.ts
    suggestionRulesOff: z.array(z.string().min(1).max(80)).max(100).default([]),
    modelSuggestions: z.boolean().default(false),
    insights: z.boolean().default(true),
    newPlaneLocation: z
      .enum([
        'current',
        'home',
        'desktop',
        'documents',
        'downloads',
        'pictures',
        'movies',
        'music',
        'custom',
      ])
      .default('current'),
    newPlanePath: z.union([z.literal(''), localPath]).default(''),
    emptyWorkspaceLocation: z
      .enum(['home', 'desktop', 'documents', 'downloads', 'pictures', 'movies', 'music', 'custom'])
      .default('home'),
    emptyWorkspacePath: z.union([z.literal(''), localPath]).default(''),
    newFileExtension: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_+-]{0,15}$/)
      .default('md'),
  })
  .strict();

export const editorSchema = z
  .object({
    fontSize: z.number().int().min(8).max(48).default(18),
    lineHeight: z.number().int().min(10).max(96).default(40),
    // a family name only: it is written into a style
    fontFamily: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/)
      .default('Menlo'),
    tabSize: z.number().int().min(1).max(16).default(4),
    insertSpaces: z.boolean().default(true),
    wordWrap: z.boolean().default(false),
    lineNumbers: z.boolean().default(true),
    trimTrailingWhitespace: z.boolean().default(true),
  })
  .strict()
  .default({
    fontSize: 18,
    lineHeight: 40,
    fontFamily: 'Menlo',
    tabSize: 4,
    insertSpaces: true,
    wordWrap: false,
    lineNumbers: true,
    trimTrailingWhitespace: true,
  });

export const terminalFontSchema = z
  .object({
    fontFamily: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/)
      .default('Hack Nerd Font Mono'),
    fontSize: z.number().int().min(8).max(48).default(17),
    fontWeight: z.enum(['normal', 'bold']).default('bold'),
    lineHeight: z.number().min(1).max(2).default(1.3),
    letterSpacing: z.number().int().min(0).max(8).default(1),
  })
  .strict()
  .default({
    fontFamily: 'Hack Nerd Font Mono',
    fontSize: 17,
    fontWeight: 'bold',
    lineHeight: 1.3,
    letterSpacing: 1,
  });

export const tilingSchema = z
  .object({
    splitWith: z.enum(['same', 'folder', 'terminal', 'scratch']).default('same'),
    defaultLayout: z.enum(tileLayouts).default('even-horizontal'),
  })
  .strict()
  .default({ splitWith: 'same', defaultLayout: 'even-horizontal' });

export const tourSchema = z
  .object({
    dwell: z.number().int().min(500).max(60000).default(3000),
    duration: z.number().int().min(100).max(10000).default(900),
    loop: z.boolean().default(true),
  })
  .strict()
  .default({ dwell: 3000, duration: 900, loop: true });
