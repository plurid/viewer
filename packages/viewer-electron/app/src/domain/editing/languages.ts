import type { FileEntry } from '../contracts';

/** A language text is highlighted in: the files it is chosen for, and its Prism grammar. */
export interface TextLanguage {
  id: string;
  label: string;
  /** Prism's grammar id; none for plain text. */
  prism?: string;
  /** Lower-case extensions, without the dot. */
  extensions: string[];
  /** Whole file names, for files named by convention rather than by extension. */
  names?: string[];
}

/**
 * Common languages. Seven grammars were loaded and every other extension fell through
 * to a grammar name nothing defined, so Rust, Go, YAML and the rest showed plain. The table is the
 * one place a language is named: highlighting, the text preview's detection and the editor read it.
 */
export const textLanguages: TextLanguage[] = [
  { id: 'plaintext', label: 'Plain text', extensions: ['txt', 'log', 'text'] },
  { id: 'javascript', label: 'JavaScript', prism: 'javascript', extensions: ['js', 'mjs', 'cjs'] },
  { id: 'jsx', label: 'JSX', prism: 'jsx', extensions: ['jsx'] },
  { id: 'typescript', label: 'TypeScript', prism: 'typescript', extensions: ['ts', 'mts', 'cts'] },
  { id: 'tsx', label: 'TSX', prism: 'tsx', extensions: ['tsx'] },
  {
    id: 'json',
    label: 'JSON',
    prism: 'json',
    extensions: ['json', 'jsonc', 'json5', 'webmanifest'],
  },
  {
    id: 'html',
    label: 'HTML',
    prism: 'markup',
    extensions: ['html', 'htm', 'xhtml', 'vue', 'svelte'],
  },
  { id: 'xml', label: 'XML', prism: 'markup', extensions: ['xml', 'svg', 'plist', 'xsl'] },
  { id: 'css', label: 'CSS', prism: 'css', extensions: ['css'] },
  { id: 'scss', label: 'SCSS', prism: 'scss', extensions: ['scss'] },
  { id: 'less', label: 'Less', prism: 'less', extensions: ['less'] },
  { id: 'markdown', label: 'Markdown', prism: 'markdown', extensions: ['md', 'markdown', 'mdx'] },
  { id: 'python', label: 'Python', prism: 'python', extensions: ['py', 'pyw', 'pyi'] },
  {
    id: 'bash',
    label: 'Shell',
    prism: 'bash',
    extensions: ['sh', 'bash', 'zsh', 'ksh'],
    names: ['.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.zshenv', '.profile'],
  },
  { id: 'c', label: 'C', prism: 'c', extensions: ['c', 'h'] },
  { id: 'cpp', label: 'C++', prism: 'cpp', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'] },
  { id: 'csharp', label: 'C#', prism: 'csharp', extensions: ['cs', 'csx'] },
  { id: 'go', label: 'Go', prism: 'go', extensions: ['go'] },
  { id: 'rust', label: 'Rust', prism: 'rust', extensions: ['rs'] },
  { id: 'java', label: 'Java', prism: 'java', extensions: ['java'] },
  { id: 'kotlin', label: 'Kotlin', prism: 'kotlin', extensions: ['kt', 'kts'] },
  { id: 'swift', label: 'Swift', prism: 'swift', extensions: ['swift'] },
  {
    id: 'ruby',
    label: 'Ruby',
    prism: 'ruby',
    extensions: ['rb', 'rake', 'gemspec'],
    names: ['Gemfile', 'Rakefile'],
  },
  { id: 'php', label: 'PHP', prism: 'php', extensions: ['php', 'phtml'] },
  { id: 'sql', label: 'SQL', prism: 'sql', extensions: ['sql'] },
  { id: 'yaml', label: 'YAML', prism: 'yaml', extensions: ['yaml', 'yml'] },
  { id: 'toml', label: 'TOML', prism: 'toml', extensions: ['toml'] },
  {
    id: 'ini',
    label: 'INI',
    prism: 'ini',
    extensions: ['ini', 'cfg', 'conf'],
    names: ['.editorconfig', '.gitconfig'],
  },
  {
    id: 'docker',
    label: 'Dockerfile',
    prism: 'docker',
    extensions: ['dockerfile'],
    names: ['Dockerfile', 'Containerfile'],
  },
  { id: 'diff', label: 'Diff', prism: 'diff', extensions: ['diff', 'patch'] },
  { id: 'graphql', label: 'GraphQL', prism: 'graphql', extensions: ['graphql', 'gql'] },
  { id: 'lua', label: 'Lua', prism: 'lua', extensions: ['lua'] },
  { id: 'r', label: 'R', prism: 'r', extensions: ['r'] },
  { id: 'perl', label: 'Perl', prism: 'perl', extensions: ['pl', 'pm'] },
  {
    id: 'makefile',
    label: 'Makefile',
    prism: 'makefile',
    extensions: ['mk', 'mak'],
    names: ['Makefile', 'GNUmakefile', 'makefile'],
  },
];

const byExtension = new Map(
  textLanguages.flatMap((language) =>
    language.extensions.map((extension) => [extension, language]),
  ),
);
const byName = new Map(
  textLanguages.flatMap((language) => (language.names ?? []).map((name) => [name, language])),
);

/** The language a file is written in, by its name first (Dockerfile, .zshrc), then its extension. */
export const languageFor = (
  entry: Pick<FileEntry, 'name' | 'extension'>,
): TextLanguage | undefined =>
  byName.get(entry.name) ?? byExtension.get(entry.extension.toLowerCase());

/** A language by its id (a scratch plane's choice). */
export const languageByID = (id: string | undefined) =>
  textLanguages.find((language) => language.id === id);

/** The name New file… starts with: `untitled`, with the configured extension. */
export const untitledFileName = (extension: string) => `untitled.${extension}`;

/** Every extension and file name the table names: the text preview's detection includes them. */
export const languageExtensions = [...byExtension.keys()];
export const languageNames = [...byName.keys()];
