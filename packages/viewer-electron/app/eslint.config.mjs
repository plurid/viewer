import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
// AGENTS.md: nothing is permanently deleted outside the reviewed removal module.
const removalMessage =
  'Permanent removal is limited to src/desktop/operations/removal.ts. Use the native Trash, a named function there, or tools/temporary.ts in tests and tools.';
const removalCalls = ['rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync'].join('|');
const removal = [
  { selector: `CallExpression[callee.name=/^(${removalCalls})$/]`, message: removalMessage },
  {
    selector: `CallExpression[callee.property.name=/^(${removalCalls})$/]`,
    message: removalMessage,
  },
];
const importType = {
  selector: 'TSImportType',
  message: 'Use a top-level import type declaration.',
};
// A module's dependencies are read in one place; re-exports may sit among them.
const importsFirst = {
  selector:
    'Program > :not(ImportDeclaration, ExportNamedDeclaration[source], ExportAllDeclaration) ~ ImportDeclaration',
  message: 'Place imports before other statements.',
};
export default tseslint.config(
  { ignores: ['.vite/**', 'out/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', importType, importsFirst, ...removal] },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'tools/**/*.ts', '*.ts'],
    rules: { 'no-restricted-syntax': ['error', importType, ...removal] },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx', 'src/renderer.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    // Type-aware: a promise nobody awaits loses its failure; `void` marks a deliberate one.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    // the policy tests lint virtual fixtures that belong to no tsconfig
    ignores: ['src/**/*-fixture.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.main.json', './tsconfig.renderer.json', './tsconfig.preload.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    files: ['src/desktop/operations/removal.ts'],
    rules: { 'no-restricted-syntax': ['error', importType, importsFirst] },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
