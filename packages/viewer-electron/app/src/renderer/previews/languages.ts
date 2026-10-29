import Prism from 'prismjs';

// The table itself has no Prism: the startup bundle reads it to choose a preview.
export {
  languageByID,
  languageExtensions,
  languageFor,
  languageNames,
  textLanguages,
  type TextLanguage,
} from '../../domain/editing/languages';

/** Each grammar's dependencies, as `prismjs/components.json` declares them: loaded first, in order. */
export const prismRequires: Record<string, string[]> = {
  markup: [],
  css: [],
  clike: [],
  javascript: ['clike'],
  typescript: ['javascript'],
  jsx: ['markup', 'javascript'],
  tsx: ['jsx', 'typescript'],
  json: [],
  scss: ['css'],
  less: ['css'],
  markdown: ['markup'],
  python: [],
  bash: [],
  c: ['clike'],
  cpp: ['c'],
  csharp: ['clike'],
  go: ['clike'],
  rust: [],
  java: ['clike'],
  kotlin: ['clike'],
  swift: [],
  ruby: ['clike'],
  'markup-templating': ['markup'],
  php: ['markup-templating'],
  sql: [],
  yaml: [],
  toml: [],
  ini: [],
  docker: [],
  diff: [],
  graphql: [],
  lua: [],
  r: [],
  perl: [],
  makefile: [],
  basic: [],
  scala: ['java'],
  dart: ['clike'],
  elixir: [],
  erlang: [],
  haskell: [],
  clojure: [],
  elm: [],
  zig: [],
  julia: [],
  ocaml: [],
  fsharp: ['clike'],
  vbnet: ['basic'],
  powershell: [],
  batch: [],
  cmake: [],
  groovy: ['clike'],
  nix: [],
  hcl: [],
  protobuf: ['clike'],
  solidity: ['clike'],
  objectivec: ['c'],
  nasm: [],
  properties: [],
  rest: [],
  asciidoc: [],
  nginx: [],
  latex: [],
};

/** Literal imports, so the bundler splits each grammar into its own chunk, loaded on first use. */
const prismLoaders: Record<string, () => Promise<unknown>> = {
  markup: () => import('prismjs/components/prism-markup'),
  css: () => import('prismjs/components/prism-css'),
  clike: () => import('prismjs/components/prism-clike'),
  javascript: () => import('prismjs/components/prism-javascript'),
  typescript: () => import('prismjs/components/prism-typescript'),
  jsx: () => import('prismjs/components/prism-jsx'),
  tsx: () => import('prismjs/components/prism-tsx'),
  json: () => import('prismjs/components/prism-json'),
  scss: () => import('prismjs/components/prism-scss'),
  less: () => import('prismjs/components/prism-less'),
  markdown: () => import('prismjs/components/prism-markdown'),
  python: () => import('prismjs/components/prism-python'),
  bash: () => import('prismjs/components/prism-bash'),
  c: () => import('prismjs/components/prism-c'),
  cpp: () => import('prismjs/components/prism-cpp'),
  csharp: () => import('prismjs/components/prism-csharp'),
  go: () => import('prismjs/components/prism-go'),
  rust: () => import('prismjs/components/prism-rust'),
  java: () => import('prismjs/components/prism-java'),
  kotlin: () => import('prismjs/components/prism-kotlin'),
  swift: () => import('prismjs/components/prism-swift'),
  ruby: () => import('prismjs/components/prism-ruby'),
  'markup-templating': () => import('prismjs/components/prism-markup-templating'),
  php: () => import('prismjs/components/prism-php'),
  sql: () => import('prismjs/components/prism-sql'),
  yaml: () => import('prismjs/components/prism-yaml'),
  toml: () => import('prismjs/components/prism-toml'),
  ini: () => import('prismjs/components/prism-ini'),
  docker: () => import('prismjs/components/prism-docker'),
  diff: () => import('prismjs/components/prism-diff'),
  graphql: () => import('prismjs/components/prism-graphql'),
  lua: () => import('prismjs/components/prism-lua'),
  r: () => import('prismjs/components/prism-r'),
  perl: () => import('prismjs/components/prism-perl'),
  makefile: () => import('prismjs/components/prism-makefile'),
  basic: () => import('prismjs/components/prism-basic'),
  scala: () => import('prismjs/components/prism-scala'),
  dart: () => import('prismjs/components/prism-dart'),
  elixir: () => import('prismjs/components/prism-elixir'),
  erlang: () => import('prismjs/components/prism-erlang'),
  haskell: () => import('prismjs/components/prism-haskell'),
  clojure: () => import('prismjs/components/prism-clojure'),
  elm: () => import('prismjs/components/prism-elm'),
  zig: () => import('prismjs/components/prism-zig'),
  julia: () => import('prismjs/components/prism-julia'),
  ocaml: () => import('prismjs/components/prism-ocaml'),
  fsharp: () => import('prismjs/components/prism-fsharp'),
  vbnet: () => import('prismjs/components/prism-vbnet'),
  powershell: () => import('prismjs/components/prism-powershell'),
  batch: () => import('prismjs/components/prism-batch'),
  cmake: () => import('prismjs/components/prism-cmake'),
  groovy: () => import('prismjs/components/prism-groovy'),
  nix: () => import('prismjs/components/prism-nix'),
  hcl: () => import('prismjs/components/prism-hcl'),
  protobuf: () => import('prismjs/components/prism-protobuf'),
  solidity: () => import('prismjs/components/prism-solidity'),
  objectivec: () => import('prismjs/components/prism-objectivec'),
  nasm: () => import('prismjs/components/prism-nasm'),
  properties: () => import('prismjs/components/prism-properties'),
  rest: () => import('prismjs/components/prism-rest'),
  asciidoc: () => import('prismjs/components/prism-asciidoc'),
  nginx: () => import('prismjs/components/prism-nginx'),
  latex: () => import('prismjs/components/prism-latex'),
};

const loading = new Map<string, Promise<void>>();

/** A grammar ready to tokenize with, its dependencies loaded first; `undefined` for one Prism lacks. */
export async function loadPrismGrammar(id: string): Promise<Prism.Grammar | undefined> {
  const loader = prismLoaders[id];
  if (!loader) return Prism.languages[id];
  let load = loading.get(id);
  if (!load) {
    load = (async () => {
      // one after another: a grammar extends the ones it requires as it loads
      for (const required of prismRequires[id] ?? []) await loadPrismGrammar(required);
      if (!Prism.languages[id]) await loader();
    })();
    loading.set(id, load);
  }
  await load;
  return Prism.languages[id];
}
