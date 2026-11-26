import { assertPreservingBuildEnvironment } from './release-environment';

assertPreservingBuildEnvironment();
const { rebuildFromSeed } = await import('./build-preserving-rebuild');
await rebuildFromSeed();
