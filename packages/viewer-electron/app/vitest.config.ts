import { defineConfig } from 'vitest/config';
import { threeRendererOwnership } from './tools/three-renderer.ts';
export default defineConfig({
  plugins: [threeRendererOwnership()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 15000,
    // DOM tests render app components with @testing-library/react; both must share one React.
    server: { deps: { inline: ['@testing-library/react'] } },
  },
});
