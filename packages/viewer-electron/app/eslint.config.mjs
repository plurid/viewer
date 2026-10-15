import tseslint from 'typescript-eslint';
// AGENTS.md: nothing is permanently deleted outside the reviewed removal module.
const removalMessage =
  'Permanent removal is limited to src/desktop/removal.ts. Use the native Trash, a named function there, or tools/temporary.ts in tests and tools.';
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
export default tseslint.config(
  { ignores: ['.vite/**', 'out/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', importType, ...removal] },
  },
  {
    files: ['tests/**/*.ts', 'tools/**/*.ts', '*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...removal] },
  },
  {
    files: ['src/desktop/removal.ts'],
    rules: { 'no-restricted-syntax': ['error', importType] },
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
