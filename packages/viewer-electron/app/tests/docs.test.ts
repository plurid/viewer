import { describe, expect, it } from 'vitest';
import { checkDocuments, markdownFacts } from '../tools/docs/markdown';

describe('documentation links', () => {
  const check = (source: string, target = '# Two views\n\n## Same\n\n## Same\n') =>
    checkDocuments(
      new Map([
        ['README.md', source],
        ['docs/guides/guide.md', target],
      ]),
      new Set(['README.md', 'docs/guides/guide.md', 'docs/media/demo.png']),
      new Set(['docs:check']),
    );

  it('resolves GFM references, duplicate heading anchors and raw HTML media', () => {
    expect(
      check(
        '[Read][guide]\n\n[guide]: docs/guides/guide.md#same-1\n\n<img src="docs/media/demo.png" alt="A folder view">',
      ),
    ).toEqual([]);
    expect(markdownFacts('# View *two*\n\n## Café & code\n').anchors).toEqual(
      new Set(['view-two', 'café--code']),
    );
  });
  it('reports stale headings, missing assets, unresolved references and private artifacts', () => {
    expect(
      check(
        '[Read](docs/guides/guide.md#old)\n\n![Demo](docs/media/gone.png)\n\n[Report](out/private.json)',
      ).map((problem) => problem.message),
    ).toEqual([
      'Missing heading: docs/guides/guide.md#old',
      'Missing link or media target: docs/media/gone.png',
      'A link points to private or generated artifacts: out/private.json',
    ]);
  });
  it('ignores example links in fenced code and checks documented package commands', () => {
    expect(
      check(
        '```md\n[example](missing.md)\n```\n\n```sh\npnpm docs:check\npnpm nonexistent\n```',
      ).map((problem) => problem.message),
    ).toEqual(['Unknown documented package command: pnpm nonexistent']);
  });
  it('rejects path escapes and private machine paths without printing their value', () => {
    const personal = '/' + 'Users' + '/example/private.txt';
    expect(
      check('[Bad](../../outside.md)\n\n' + personal).map((problem) => problem.message),
    ).toEqual(['Contains a private machine path.', 'A link escapes the repository.']);
  });
  it('keeps the docs root clear and requires pages to use known sections', () => {
    const documents = new Map([
      ['docs/README.md', '# Documentation'],
      ['docs/guides/README.md', '# Guides'],
      ['docs/followup.md', '# Old followup'],
      ['docs/misc/notes.md', '# Uncategorized notes'],
    ]);
    expect(checkDocuments(documents, new Set(documents.keys()), new Set())).toEqual([
      {
        file: 'docs/followup.md',
        message: 'Put this page in a documented section; docs/ contains only its README.',
      },
      {
        file: 'docs/misc/notes.md',
        message: 'Put this page in a documented section; docs/ contains only its README.',
      },
    ]);
  });
});
