import path from 'node:path';
import { defineConfig } from 'vitest/config';
// The hoisted workspace install; an app-level node_modules may hold older store links.
const hoisted = (name: string) => path.resolve(import.meta.dirname, '../../../node_modules', name);
export default defineConfig({
  // App code and @testing-library/react must share one React instance in DOM tests.
  resolve: { alias: { react: hoisted('react'), 'react-dom': hoisted('react-dom') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    server: { deps: { inline: ['@testing-library/react'] } },
  },
});
