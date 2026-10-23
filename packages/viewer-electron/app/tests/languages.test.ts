import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  languageFor,
  loadPrismGrammar,
  prismRequires,
  textLanguages,
} from '../src/renderer/previews/languages';
import { choosePreview } from '../src/renderer/previews/registry';

const file = (name: string): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension:
    name.includes('.') && !name.startsWith('.') ? name.split('.').pop()!.toLowerCase() : '',
  mime: 'application/octet-stream',
  size: 0,
  kind: 'file',
  directory: false,
  identity: 'fixture',
  modified: 0,
  created: 0,
  hidden: false,
});

/**
 * COMMON LANGUAGES ARE HIGHLIGHTED (2026-10-23). Seven grammars were loaded, and every other
 * extension fell through to a grammar name nothing defined, so Rust, Go, YAML and the rest showed plain.
 */
describe('the language table', () => {
  it('names a language by extension, by file name, and by a dotfile', () => {
    const id = (name: string) => languageFor(file(name))?.id;
    expect(id('main.rs')).toBe('rust');
    expect(id('server.go')).toBe('go');
    expect(id('App.tsx')).toBe('tsx');
    expect(id('config.YML')).toBe('yaml');
    expect(id('Dockerfile')).toBe('docker');
    expect(id('Makefile')).toBe('makefile');
    expect(id('.zshrc')).toBe('bash');
    expect(id('notes.txt')).toBe('plaintext');
    expect(id('archive.xyz')).toBeUndefined();
  });

  it("takes each grammar's dependencies from Prism's own catalogue", () => {
    const catalogue = createRequire(import.meta.url)('prismjs/components.json').languages as Record<
      string,
      { require?: string | string[] }
    >;
    for (const [grammar, requires] of Object.entries(prismRequires)) {
      const declared = catalogue[grammar]?.require;
      expect(requires, grammar).toEqual(declared ? [declared].flat() : []);
    }
    for (const language of textLanguages)
      if (language.prism) expect(Object.keys(prismRequires), language.id).toContain(language.prism);
  });

  it('loads a grammar on first use, its dependencies first', async () => {
    const Prism = (await import('prismjs')).default;
    expect(await loadPrismGrammar('tsx')).toBe(Prism.languages.tsx);
    expect(Prism.languages.jsx).toBeDefined();
    expect(await loadPrismGrammar('php')).toBe(Prism.languages.php);
    expect(Prism.languages['markup-templating']).toBeDefined();
    expect(await loadPrismGrammar('rust')).toBe(Prism.languages.rust);
    expect(await loadPrismGrammar('nonexistent')).toBeUndefined();
  });

  it('loads grammars only through the loader, after the core', async () => {
    // A grammar file sets `Prism.languages` on the global the core defines. Imported statically, the
    // bundle split some into chunks that ran before the core: "Prism is not defined" (2026-10-23).
    const { readFile, readdir } = await import('node:fs/promises');
    const sources = (await readdir('src', { recursive: true })).filter(
      (file) => /\.tsx?$/.test(file) && !file.endsWith('previews/languages.ts'),
    );
    const importing = [];
    for (const file of sources)
      if (/import\s+['"]prismjs\/components\//.test(await readFile(`src/${file}`, 'utf8')))
        importing.push(file);
    expect(importing).toEqual([]);
  });
  it('previews every file the table names, as text unless a richer preview claims it (SVG)', () => {
    for (const language of textLanguages) {
      for (const extension of language.extensions)
        expect(choosePreview(file(`fixture.${extension}`)).id, extension).not.toBe('fallback');
      for (const name of language.names ?? [])
        expect(choosePreview(file(name)).id, name).toBe('text');
    }
    for (const name of ['main.rs', 'init.lua', 'fix.diff', 'Program.cs', 'theme.less', 'plot.r'])
      expect(choosePreview(file(name)).id, name).toBe('text');
  });
});
