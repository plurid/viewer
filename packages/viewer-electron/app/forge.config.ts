import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import store from './mac-app-store.json' with { type: 'json' };
import { macChannel, storeConfiguration, storeInputs } from './tools/mas-configuration';
const require = createRequire(import.meta.url);
const channel = macChannel(process.env.VIEWER_MAC_CHANNEL);
const storeConfig = storeConfiguration.parse(store);
const inputs = channel === 'direct' ? undefined : storeInputs(process.env, channel);
const storeSigning = inputs
  ? {
      identity: inputs.identity,
      identityValidation: true,
      type: channel === 'mas-dev' ? ('development' as const) : ('distribution' as const),
      provisioningProfile: inputs.profile,
      preEmbedProvisioningProfile: true,
      preAutoEntitlements: false,
      strictVerify: true,
      optionsForFile: (file: string) => ({
        hardenedRuntime: false,
        entitlements: path.resolve(
          'out/mac-app-store/entitlements',
          channel,
          path.basename(file) === 'Viewer.app' ? 'main.plist' : 'inherit.plist',
        ),
      }),
    }
  : undefined;
const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/node-pty/**' },
    extraResource: [
      'assets/licenses',
      ...(process.platform === 'darwin' ? ['assets/viewer-ocr', 'assets/viewer-applications'] : []),
    ],
    appBundleId: channel === 'direct' ? 'com.plurid.viewer' : storeConfig.bundleID,
    ...(inputs
      ? { buildVersion: inputs.build, extendInfo: { ElectronTeamID: storeConfig.teamID } }
      : {}),
    appCategoryType: 'public.app-category.utilities',
    name: 'Viewer',
    icon: 'assets/icon.icns',
    // Local ad-hoc signing keeps Apple Silicon bundles runnable after packaging.
    // Distribution identities and notarization belong to the release configuration.
    osxSign: storeSigning ?? {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      // Do not inherit the signer's broad camera/microphone/device defaults.
      // The MAS build will need its own sandbox and helper-inheritance entitlements.
      optionsForFile: () => ({
        hardenedRuntime: false,
        entitlements: 'assets/entitlements.mac.plist',
      }),
    },
  },
  rebuildConfig: { onlyModules: ['node-pty'] },
  hooks: {
    packageAfterExtract: async (_config, _buildPath, _electronVersion, platform) => {
      if ((platform === 'mas') !== (channel !== 'direct'))
        throw new Error(
          'Use pnpm mas:dev / mas:package for the MAS runtime; normal packaging uses the direct channel.',
        );
    },
    // Vite packages its bundles only. Keep external native modules available to
    // Electron's rebuild and ASAR unpacking, including node-pty's spawn helper.
    packageAfterCopy: async (_config, buildPath) => {
      for (const dependency of ['node-pty', 'node-addon-api']) {
        const source = path.dirname(require.resolve(dependency + '/package.json'));
        await fs.cp(source, path.join(buildPath, 'node_modules', dependency), { recursive: true });
      }
    },
  },
  makers: channel === 'direct' ? [new MakerZIP({}, ['darwin'])] : [],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        {
          entry: 'src/desktop/terminal-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
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
