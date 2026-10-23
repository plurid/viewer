import type { Extension } from '@codemirror/state';
import { StreamLanguage, type StreamParser } from '@codemirror/language';

const legacy = (load: () => Promise<StreamParser<unknown>>) => async () =>
  StreamLanguage.define(await load());

/**
 * The editor's language for each id of the highlighting table (`../languages.ts`), loaded on first
 * use: literal imports, so each language is its own chunk. `null` edits as plain text (no CodeMirror
 * mode exists for it); Prism still highlights it when read.
 */
export const editorLanguages: Record<string, (() => Promise<Extension>) | null> = {
  plaintext: null,
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  typescript: () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  scss: legacy(() => import('@codemirror/legacy-modes/mode/sass').then((m) => m.sass)),
  less: () => import('@codemirror/lang-css').then((m) => m.css()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  bash: legacy(() => import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell)),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  csharp: legacy(() => import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp)),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  kotlin: legacy(() => import('@codemirror/legacy-modes/mode/clike').then((m) => m.kotlin)),
  swift: legacy(() => import('@codemirror/legacy-modes/mode/swift').then((m) => m.swift)),
  ruby: legacy(() => import('@codemirror/legacy-modes/mode/ruby').then((m) => m.ruby)),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  toml: legacy(() => import('@codemirror/legacy-modes/mode/toml').then((m) => m.toml)),
  ini: legacy(() => import('@codemirror/legacy-modes/mode/properties').then((m) => m.properties)),
  docker: legacy(() =>
    import('@codemirror/legacy-modes/mode/dockerfile').then((m) => m.dockerFile),
  ),
  diff: legacy(() => import('@codemirror/legacy-modes/mode/diff').then((m) => m.diff)),
  graphql: null,
  lua: legacy(() => import('@codemirror/legacy-modes/mode/lua').then((m) => m.lua)),
  r: legacy(() => import('@codemirror/legacy-modes/mode/r').then((m) => m.r)),
  perl: legacy(() => import('@codemirror/legacy-modes/mode/perl').then((m) => m.perl)),
  makefile: null,
};
