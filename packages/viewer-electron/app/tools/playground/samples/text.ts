import { textLanguages } from '../../../src/domain/editing/languages';
import { sample } from './documents';
import type { Sample } from '../types';

const snippets: Record<string, string> = {
  plaintext:
    'Field notes\n==========\n\nOpen a file, compare another view, and keep the folder nearby.\n',
  javascript:
    'export function area(width, height) {\n  return width * height;\n}\n\nconsole.log(area(200, 100));\n',
  jsx: 'export function Material({ name }) {\n  return <article><h2>{name}</h2><p>Ready for review</p></article>;\n}\n',
  typescript:
    'export interface Material {\n  name: string;\n  thickness: number;\n}\n\nexport const panel: Material = {\n  name: "Aluminum",\n  thickness: 3,\n};\n',
  tsx: 'interface Props {\n  name: string;\n}\n\nexport function Material({ name }: Props) {\n  return <article><h2>{name}</h2><p>Ready for review</p></article>;\n}\n',
  json: '{\n  "project": "Field notes",\n  "parts": [\n    { "name": "Panel", "quantity": 12 },\n    { "name": "Spacer", "quantity": 24 }\n  ],\n  "reviewed": false\n}\n',
  html: `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <title>Field notes</title>
  <h1>A small project, a wider view</h1>
  <p>This local document has no external resources.</p>
</html>
`,
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<project name="Field notes">\n  <material name="Aluminum" thickness="3"/>\n  <material name="Nylon" thickness="8"/>\n</project>\n',
  css: ':root {\n  color-scheme: light dark;\n  font-family: system-ui, sans-serif;\n}\n\narticle {\n  max-width: 42rem;\n  margin-inline: auto;\n  padding: 2rem;\n}\n',
  scss: '$accent: #376b7b;\n\n.material {\n  color: $accent;\n\n  h2 {\n    margin-block: 0 1rem;\n  }\n}\n',
  less: '@accent: #376b7b;\n\n.material {\n  color: @accent;\n  h2 { margin-bottom: 1rem; }\n}\n',
  markdown: `# Field notes

Keep the project and its evidence visible together.

## Review checklist

- [x] Open the reference drawing
- [ ] Compare the material variants
- [ ] Read the final brief

| Part | Material | Quantity |
| --- | --- | ---: |
| Panel | Aluminum | 12 |
| Spacer | Nylon | 24 |

\`\`\`typescript
const dimensions = { width: 200, height: 100 };
\`\`\`

Unicode: București · 東京 · café.
`,
  python: `from dataclasses import dataclass


@dataclass(frozen=True)
class Panel:
    width: float
    height: float

    def area(self) -> float:
        return self.width * self.height


print(Panel(200, 100).area())
`,
  bash: '#!/bin/sh\n# Fictional example: only prints a greeting when explicitly run.\nprintf "%s\\n" "Hello from the Viewer playground"\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Panel area: %d\\n", 200 * 100);\n    return 0;\n}\n',
  cpp: `#include <iostream>

struct Panel {
    double width;
    double height;
};

int main() {
    const Panel panel{200, 100};
    std::cout << panel.width * panel.height << "\\n";
}
`,
  csharp:
    'using System;\n\npublic record Panel(double Width, double Height)\n{\n    public double Area => Width * Height;\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Panel area:", 200*100)\n}\n',
  rust: `#[derive(Debug)]
struct Panel {
    width: f64,
    height: f64,
}

fn main() {
    let panel = Panel { width: 200.0, height: 100.0 };
    println!("Area: {}", panel.width * panel.height);
}
`,
  java: 'public class Panel {\n    public static void main(String[] args) {\n        System.out.println("Panel area: " + 200 * 100);\n    }\n}\n',
  kotlin:
    'data class Panel(val width: Double, val height: Double) {\n    fun area(): Double = width * height\n}\n\nfun main() {\n    println(Panel(200.0, 100.0).area())\n}\n',
  swift:
    'struct Panel {\n    let width: Double\n    let height: Double\n\n    var area: Double { width * height }\n}\n\nprint(Panel(width: 200, height: 100).area)\n',
  ruby: 'Panel = Struct.new(:width, :height, keyword_init: true) do\n  def area\n    width * height\n  end\nend\n\nputs Panel.new(width: 200, height: 100).area\n',
  php: '<?php\nfunction panelArea(float $width, float $height): float\n{\n    return $width * $height;\n}\n\necho panelArea(200, 100);\n',
  sql: `CREATE TABLE materials (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL
);

INSERT INTO materials VALUES (1, 'Aluminum panel', 12);
SELECT name, quantity FROM materials ORDER BY name;
`,
  yaml: 'project: Field notes\nmaterials:\n  - name: Aluminum\n    quantity: 12\n  - name: Nylon\n    quantity: 24\n',
  toml: '[project]\nname = "Field notes"\nreviewed = false\n\n[[materials]]\nname = "Aluminum"\nquantity = 12\n',
  ini: '[project]\nname = Field notes\nreviewed = false\n\n[panel]\nmaterial = Aluminum\nthickness = 3\n',
  docker:
    '# Source inspection only; no build or image pull is started by Viewer.\nFROM scratch\nCOPY README.md /README.md\n',
  diff: '--- a/materials.txt\n+++ b/materials.txt\n@@ -1,2 +1,2 @@\n-Aluminum, 6\n+Aluminum, 12\n Nylon, 24\n',
  graphql:
    'type Material {\n  id: ID!\n  name: String!\n  quantity: Int!\n}\n\ntype Query {\n  materials: [Material!]!\n}\n',
  lua: 'local panel = { width = 200, height = 100 }\n\nlocal function area(value)\n    return value.width * value.height\nend\n\nprint(area(panel))\n',
  r: 'materials <- data.frame(\n  name = c("Aluminum", "Nylon"),\n  quantity = c(12, 24)\n)\n\nprint(materials)\n',
  perl: 'use strict;\nuse warnings;\n\nmy %panel = (width => 200, height => 100);\nprint $panel{width} * $panel{height}, "\\n";\n',
  makefile: '.PHONY: hello\n\nhello:\n\t@printf "%s\\n" "Hello from the Viewer playground"\n',
};

const variants: Record<string, string> = {
  cjs: 'module.exports = { name: "Field notes", reviewed: false };\n',
  cts: 'const project: string = "Field notes";\nexport = project;\n',
  jsonc: '// Comments are shown as source.\n{\n  "name": "Field notes",\n  "reviewed": false\n}\n',
  json5: '// JSON5 source: unquoted key and trailing comma.\n{\n  name: "Field notes",\n}\n',
  xhtml: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Field notes</title>
  </head>
  <body>
    <h1>A local XHTML document</h1>
    <p>No external assets.</p>
  </body>
</html>
`,
  vue: '<template>\n  <article><h1>{{ title }}</h1><p>Vue source is inspected, not executed.</p></article>\n</template>\n\n<script setup>\nconst title = "Field notes";\n</script>\n',
  svelte:
    '<script>\n  let title = "Field notes";\n</script>\n\n<article>\n  <h1>{title}</h1>\n  <p>Svelte source is inspected, not executed.</p>\n</article>\n',
  plist:
    '<?xml version="1.0"?><plist version="1.0"><dict><key>Name</key><string>Field notes</string><key>Reviewed</key><false/></dict></plist>\n',
  xsl: `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <h1><xsl:value-of select="project/@name" /></h1>
  </xsl:template>
</xsl:stylesheet>
`,
};

export function textSamples(): Sample[] {
  const result: Sample[] = [];
  for (const language of textLanguages) {
    for (const format of language.extensions) {
      if (format === 'svg') continue; // The image catalog supplies a genuine SVG.
      const bytes = variants[format] ?? snippets[language.id];
      if (!bytes) throw new Error(`Missing playground recipe for ${language.id}.`);
      const family = ['html', 'htm', 'xhtml'].includes(format) ? 'documents' : 'code-and-data';
      result.push(
        sample(
          `previews/${family}/Example.${format}`,
          [format],
          family === 'documents'
            ? 'Sandboxed HTML rendering and source'
            : `${language.label} source`,
          `${language.label} example; source coverage does not imply executing the project.`,
          bytes,
        ),
      );
    }
    for (const name of language.names ?? [])
      result.push(
        sample(
          `previews/code-and-data/conventional-names/${name}`,
          [],
          `${language.label} source`,
          'Conventional filename detection.',
          snippets[language.id],
        ),
      );
  }
  for (const [name, formats, bytes] of [
    [
      'Example.csv',
      ['csv'],
      'Part,Material,Quantity\nPanel,Aluminum,12\nSpacer,"Nylon, white",24\n',
    ],
    ['Example.tsv', ['tsv'], 'Part\tMaterial\tQuantity\nPanel\tAluminum\t12\nSpacer\tNylon\t24\n'],
    [
      'Events.jsonl',
      ['jsonl'],
      '{"event":"open","plane":"folder"}\n{"event":"preview","format":"pdf"}\n',
    ],
    [
      'Example.tex',
      ['tex'],
      '\\documentclass{article}\n\\begin{document}\n\\section{Field notes}\nSource preview does not run TeX.\n\\end{document}\n',
    ],
    [
      '.env',
      ['env'],
      '# Fictional local settings; no credentials.\nPROJECT_NAME="Field notes"\nLOCAL_PORT=8080\n',
    ],
    ['.env.local', [], 'PROJECT_NAME="Local field notes"\n'],
    [
      '.gitignore',
      ['gitignore'],
      '# A source-preview example; no files are removed.\nnode_modules/\nout/\n.DS_Store\n',
    ],
    ['README', [], 'Field notes\n\nConventional plain-text filename.\n'],
    ['LICENSE', [], 'CC0 1.0: this generated sample text is dedicated to the public domain.\n'],
  ] as [string, string[], string][]) {
    result.push(
      sample(
        `previews/code-and-data/${name}`,
        formats,
        name.endsWith('.csv') || name.endsWith('.tsv')
          ? 'Delimited table and source'
          : 'Text/source',
        'A declared text/data format or conventional filename.',
        bytes,
      ),
    );
  }
  return result;
}
