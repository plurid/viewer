import type { ForgeConfig } from '@electron-forge/shared-types';
import { directMakers } from './tools/make-targets';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import store from './mac-app-store.json' with { type: 'json' };
import manifest from './package.json' with { type: 'json' };
import { alphaVersionSchema, storeVersion } from './src/domain/updates/version';
import { restoreAlphaVersion } from './tools/bundle-version';
import { macChannel, storeConfiguration, storeInputs } from './tools/mas-configuration';
import { documentTypes } from './tools/document-types';
import { claimForgePhase, requireNewPackage } from './tools/package-build';
import { copyPDFRuntime } from './tools/pdf-runtime';
import { officeRuntimeName } from './src/desktop/previews/office-runtime-manifest';
import { prepareNativeRebuild } from './tools/native-build/rebuild';
import { speechRuntimeName } from './src/desktop/speech/runtime-manifest';
import { applicationCopyright } from './src/desktop/release';
import { macOSMinimum } from './tools/native-build/macos-target';
import { directBuildNumber } from './tools/build-number';
import { nodePtyFileUsed, patchedNodePtySource, trimElectronTemplate } from './tools/bundle-trim';
import {
  assertMacPackagingArch,
  assertMakeOutputAvailable,
  assertRetainedNotarization,
  directSigningIdentity,
} from './tools/trash-previous-build';
const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const channel = macChannel(process.env.VIEWER_MAC_CHANNEL);
const storeConfig = storeConfiguration.parse(store);
const inputs = channel === 'direct' ? undefined : storeInputs(process.env, channel);
const version = alphaVersionSchema.parse(manifest.version);
const directIdentity =
  channel === 'direct' ? directSigningIdentity(process.env.VIEWER_DIRECT_IDENTITY) : undefined;
const storeSigning = inputs
  ? {
      identity: inputs.identity,
      continueOnError: false,
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
    appVersion: inputs ? storeVersion(version) : version,
    asar: { unpack: '**/{node-pty,@napi-rs}/**' },
    // Packager writes appVersion into the copied manifest before this hook and signs after ASAR.
    beforeAsar: inputs ? [({ buildPath }) => restoreAlphaVersion(buildPath, version)] : [],
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
      // SSH connections are direct-build only: the Store sandbox cannot run /usr/bin/ssh.
      ...(process.platform === 'darwin' && channel === 'direct' ? ['assets/viewer-askpass'] : []),
    ],
    appBundleId: channel === 'direct' ? 'com.plurid.viewer' : storeConfig.bundleID,
    extendInfo: {
      LSMinimumSystemVersion: macOSMinimum,
      NSDocumentsFolderUsageDescription:
        'Viewer shows, previews and searches the files in your Documents folder.',
      NSDesktopFolderUsageDescription:
        'Viewer shows, previews and searches the files on your Desktop.',
      NSDownloadsFolderUsageDescription:
        'Viewer shows, previews and searches the files in your Downloads folder.',
      NSRemovableVolumesUsageDescription:
        'Viewer shows and previews the files on external drives you open.',
      NSNetworkVolumesUsageDescription:
        'Viewer shows and previews the files on network drives you open.',
      // Viewer does not use Bluetooth. A web page in a browser plane can make Chromium start
      // it, and macOS stops an app that has no purpose string for it.
      NSBluetoothAlwaysUsageDescription:
        'Viewer does not use Bluetooth. A web page you open in a browser plane may ask for it.',
      NSBluetoothPeripheralUsageDescription:
        'Viewer does not use Bluetooth. A web page you open in a browser plane may ask for it.',
      NSMicrophoneUsageDescription:
        'Viewer records audio only when you start dictation. Local transcription keeps your audio on this device.',
      // Local profiles permit configured HTTPS LAN endpoints. macOS 15+ needs
      // this purpose text for its separate local-network authorization.
      NSLocalNetworkUsageDescription:
        channel === 'direct'
          ? 'Viewer connects to SSH servers you choose for file browsing and to local model endpoints you choose for AI actions and dictation.'
          : 'Viewer connects to local model endpoints you choose for AI actions and dictation.',
      ...(inputs ? { ElectronTeamID: storeConfig.teamID } : {}),
      // The App Store build would receive access to an opened file only, which Viewer's
      // folder-based access does not handle yet, so only the direct build offers Open With.
      ...(channel === 'direct' ? { CFBundleDocumentTypes: documentTypes } : {}),
    },
    // CFBundleVersion: the Store's own build number, or the commit count (tools/build-number.ts).
    buildVersion: inputs?.build ?? directBuildNumber(appRoot),
    appCopyright: applicationCopyright,
    appCategoryType: 'public.app-category.utilities',
    name: 'Viewer',
    icon: 'assets/icon.icns',
    // Local ad-hoc signing keeps Apple Silicon bundles runnable after packaging.
    // Distribution identities and notarization belong to the release configuration.
    osxSign: storeSigning ?? {
      identity: directIdentity || '-',
      continueOnError: false,
      identityValidation: !!directIdentity,
      preAutoEntitlements: false,
      // Do not inherit the signer's broad camera/device defaults.
      // The MAS build will need its own sandbox and helper-inheritance entitlements.
      optionsForFile: () => ({
        hardenedRuntime: !!directIdentity,
        entitlements: 'assets/entitlements.mac.plist',
      }),
    },
  },
  rebuildConfig: { onlyModules: ['node-pty'], force: true },
  hooks: {
    prePackage: async (_config, platform, arch) => {
      if (channel === 'direct') assertRetainedNotarization(process.env.VIEWER_NOTARY_PROFILE);
      if ((platform === 'mas') !== (channel !== 'direct'))
        throw new Error(
          'Use pnpm mas:dev / mas:package for the MAS runtime. Normal packaging uses the direct channel.',
        );
      if (platform === 'darwin' || platform === 'mas')
        assertMacPackagingArch(arch, process.env.VIEWER_BUILD_ARCH ?? process.arch);
      await claimForgePhase(appRoot, 'prePackage');
      await requireNewPackage(appRoot, platform, arch);
    },
    preMake: async () => {
      await claimForgePhase(appRoot, 'preMake');
      if (channel === 'direct') assertRetainedNotarization(process.env.VIEWER_NOTARY_PROFILE);
      await assertMakeOutputAvailable(path.join(appRoot, 'out'));
    },
    resolveForgeConfig: async (_config, resolved) => {
      // Forge start rebuilds before preStart. Resolve headers before either start or package.
      await prepareNativeRebuild({
        appRoot,
        electronVersion: require('electron/package.json').version,
        arch: process.arch,
      });
      return resolved;
    },
    packageAfterExtract: async (_config, buildPath) => {
      // English only, without unused purpose strings; the app is signed after this.
      await trimElectronTemplate(buildPath);
    },
    // Vite packages its bundles only. Preserve external PDF.js ESM and native
    // modules for Node resolution, Electron's rebuild and ASAR unpacking.
    packageAfterCopy: async (_config, buildPath, electronVersion, platform, arch) => {
      await prepareNativeRebuild({ appRoot, electronVersion, arch });
      await copyPDFRuntime(buildPath, platform, arch, require);
      for (const dependency of ['node-pty', 'node-addon-api']) {
        const source = path.dirname(require.resolve(dependency + '/package.json'));
        await fs.cp(source, path.join(buildPath, 'node_modules', dependency), {
          recursive: true,
          // Other platforms' prebuilds and the Windows ConPTY files stay out of the bundle.
          filter: (file) =>
            dependency !== 'node-pty' ||
            nodePtyFileUsed(path.relative(source, file), platform, arch),
        });
      }
      const source = path.join(buildPath, 'node_modules/node-pty/src/unix/pty.cc');
      await fs.writeFile(source, await patchedNodePtySource(source));
    },
  },
  makers: channel === 'direct' ? directMakers() : [],
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
          entry: 'src/desktop/remote/remote-worker.ts',
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
          entry: 'src/desktop/windows/folder-history-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/workspaces/folder-facts-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/files/folder-size-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        {
          entry: 'src/desktop/workers/preview-worker.ts',
          config: 'vite.services.config.ts',
          target: 'main',
        },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/report-preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
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
