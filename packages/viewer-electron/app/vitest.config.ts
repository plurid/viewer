import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    // DOM tests render app components with @testing-library/react; both must share one React.
    server: { deps: { inline: ['@testing-library/react'] } },
  },
});
