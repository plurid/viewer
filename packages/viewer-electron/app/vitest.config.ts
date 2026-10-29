import { defineConfig } from 'vitest/config';
import { threeRendererOwnership } from './tools/three-renderer.ts';
export default defineConfig({
  plugins: [threeRendererOwnership()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 15000,
    // a run's folders in one folder (tools/temporary.ts)
    globalSetup: ['tests/support/run-root.ts'],
    // DOM tests render app components with @testing-library/react; both must share one React.
    server: { deps: { inline: ['@testing-library/react'] } },
  },
});
