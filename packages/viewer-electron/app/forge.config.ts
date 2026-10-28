import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import store from './mac-app-store.json' with { type: 'json' };
import { macChannel, storeConfiguration, storeInputs } from './tools/mas-configuration';
import { documentTypes } from './tools/document-types';
import { copyPDFRuntime } from './tools/pdf-runtime';
import { officeRuntimeName } from './src/desktop/previews/office-runtime-manifest';
import { prepareNativeRebuild } from './tools/native-build/rebuild';
import { speechRuntimeName } from './src/desktop/speech/runtime-manifest';
const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const channel = macChannel(process.env.VIEWER_MAC_CHANNEL);
const storeConfig = storeConfiguration.parse(store);
const inputs = channel === 'direct' ? undefined : storeInputs(process.env, channel);
const directIdentity =
  channel === 'direct' ? process.env.VIEWER_DIRECT_IDENTITY?.trim() : undefined;
const notaryProfile = channel === 'direct' ? process.env.VIEWER_NOTARY_PROFILE?.trim() : undefined;
if (notaryProfile && !directIdentity)
  throw new Error('Notarization requires VIEWER_DIRECT_IDENTITY (Developer ID Application).');
if (
  directIdentity &&
  (directIdentity === '-' ||
    (!/^[A-Fa-f0-9]{40}$/.test(directIdentity) &&
      !directIdentity.startsWith('Developer ID Application:')))
)
  throw new Error('VIEWER_DIRECT_IDENTITY must identify a Developer ID Application certificate.');
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
    asar: { unpack: '**/{node-pty,@napi-rs}/**' },
    extraResource: [
      'assets/licenses',
      `assets/${officeRuntimeName}`,
      ...(process.platform === 'darwin'
        ? [
            `assets/viewer-processors-darwin-${process.env.VIEWER_BUILD_ARCH ?? process.arch}`,
            `assets/viewer-optimizers-darwin-${process.env.VIEWER_BUILD_ARCH ?? process.arch}`,
            `assets/viewer-raw-v3-darwin-${process.env.VIEWER_BUILD_ARCH ?? process.arch}`,
            `assets/${speechRuntimeName(process.env.VIEWER_BUILD_ARCH ?? process.arch)}`,
          ]
        : []),
      ...(process.platform === 'darwin'
        ? [
            'assets/viewer-ocr',
            'assets/viewer-applications',
            'assets/viewer-macos-files.node',
            'assets/viewer-image-preview',
          ]
        : []),
    ],
    appBundleId: channel === 'direct' ? 'com.plurid.viewer' : storeConfig.bundleID,
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Viewer records audio only when you start dictation. Local transcription keeps your audio on this device.',
      // Local profiles permit configured HTTPS LAN endpoints. macOS 15+ needs
      // this purpose text for its separate local-network authorization.
      NSLocalNetworkUsageDescription:
        'Viewer connects to model endpoints you configure on your local network for model discovery and AI actions.',
      ...(inputs ? { ElectronTeamID: storeConfig.teamID } : {}),
      // The App Store build would receive access to an opened file only, which Viewer's
      // folder-based access does not handle yet, so only the direct build offers Open With.
      ...(channel === 'direct' ? { CFBundleDocumentTypes: documentTypes } : {}),
    },
    ...(inputs ? { buildVersion: inputs.build } : {}),
    appCategoryType: 'public.app-category.utilities',
    name: 'Viewer',
    icon: 'assets/icon.icns',
    // Local ad-hoc signing keeps Apple Silicon bundles runnable after packaging.
    // Distribution identities and notarization belong to the release configuration.
    osxSign: storeSigning ?? {
      identity: directIdentity || '-',
      identityValidation: !!directIdentity,
      preAutoEntitlements: false,
      // Do not inherit the signer's broad camera/device defaults.
      // The MAS build will need its own sandbox and helper-inheritance entitlements.
      optionsForFile: () => ({
        hardenedRuntime: !!directIdentity,
        entitlements: 'assets/entitlements.mac.plist',
      }),
    },
    ...(notaryProfile ? { osxNotarize: { keychainProfile: notaryProfile } } : {}),
  },
  rebuildConfig: { onlyModules: ['node-pty'], force: true },
  hooks: {
    resolveForgeConfig: async (_config, resolved) => {
      // Forge start rebuilds before preStart. Resolve headers before either start or package.
      await prepareNativeRebuild({
        appRoot,
        electronVersion: require('electron/package.json').version,
        arch: process.arch,
      });
      return resolved;
    },
    packageAfterExtract: async (_config, _buildPath, _electronVersion, platform) => {
      if ((platform === 'mas') !== (channel !== 'direct'))
        throw new Error(
          'Use pnpm mas:dev / mas:package for the MAS runtime; normal packaging uses the direct channel.',
        );
    },
    // Vite packages its bundles only. Preserve external PDF.js ESM and native
    // modules for Node resolution, Electron's rebuild and ASAR unpacking.
    packageAfterCopy: async (_config, buildPath, electronVersion, platform, arch) => {
      await prepareNativeRebuild({ appRoot, electronVersion, arch });
      await copyPDFRuntime(buildPath, platform, arch);
      for (const dependency of ['node-pty', 'node-addon-api']) {
        const source = path.dirname(require.resolve(dependency + '/package.json'));
        await fs.cp(source, path.join(buildPath, 'node_modules', dependency), { recursive: true });
      }
      // macOS App Sandbox permits termios/resize ioctls on the owned PTY
      // master, but not on its slave device. Both endpoints share termios and
      // window size. Keep this small compatibility patch in the packaged copy;
      // Forge then rebuilds it for Electron. Never edit the installed package.
      const source = path.join(buildPath, 'node_modules/node-pty/src/unix/pty.cc');
      let code = await fs.readFile(source, 'utf8');
      for (const [before, after] of [
        ['tcsetattr(slave, TCSANOW, termp)', 'tcsetattr(*master, TCSANOW, termp)'],
        ['ioctl(slave, TIOCSWINSZ, winp)', 'ioctl(*master, TIOCSWINSZ, winp)'],
      ]) {
        if (!code.includes(before))
          throw new Error(
            'Review the node-pty sandbox compatibility patch after updating node-pty.',
          );
        code = code.replace(before, after);
      }
      await fs.writeFile(source, code);
    },
  },
  makers: channel === 'direct' ? [new MakerZIP({}, ['darwin'])] : [],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        {
          entry: 'src/desktop/terminals/terminal-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/workers/worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/transforms/image-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/actions/rename-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/files/folder-size-worker.ts',
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
      // Viewer never loads file:// pages; deny them the legacy extra privileges.
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};
export default config;
