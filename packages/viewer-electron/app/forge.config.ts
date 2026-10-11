import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource:
      process.platform === 'darwin' ? ['assets/viewer-ocr', 'assets/viewer-applications'] : [],
    appBundleId: 'com.plurid.viewer',
    appCategoryType: 'public.app-category.utilities',
    name: 'Viewer',
    icon: 'assets/icon.icns',
    // Local ad-hoc signing keeps Apple Silicon bundles runnable after packaging.
    // Distribution identities and notarization belong to the release configuration.
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/desktop/worker.ts', config: 'vite.services.config.ts', target: 'main' },
        {
          entry: 'src/desktop/folder-size-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
export default config;
