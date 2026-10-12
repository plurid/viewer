import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  storeConfiguration,
  storeEntitlements,
  storeInputs,
  validateStoreProfile,
  type ProfileSummary,
  type StoreChannel,
} from './mas-configuration';

const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2] ?? 'preflight';
const channel: StoreChannel =
  command === 'distribution' || process.env.VIEWER_MAC_CHANNEL === 'mas' ? 'mas' : 'mas-dev';
const run = (executable: string, args: string[], input?: Buffer) =>
  execFileSync(executable, args, { encoding: 'utf8', input, maxBuffer: 4_000_000 });

function identity(
  requested: string,
  teamID: string,
  kind: 'development' | 'distribution' | 'installer',
  authorizedHashes?: string[],
) {
  const found = run('/usr/bin/security', [
    'find-identity',
    '-v',
    '-p',
    kind === 'installer' ? 'basic' : 'codesigning',
  ]);
  const identities = [...found.matchAll(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/gm)];
  const selected = identities.find(
    (item) => item[1] === requested.toUpperCase() || item[2] === requested,
  );
  if (!selected)
    throw new Error('The selected signing identity is not valid and available in Keychain.');
  const certificates =
    run('/usr/bin/security', ['find-certificate', '-a', '-c', selected[2], '-p']).match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    ) ?? [];
  const certificate = certificates
    .map((pem) => new X509Certificate(pem))
    .find((value) => value.fingerprint.replace(/:/g, '') === selected[1]);
  if (!certificate || !certificate.subject.split('\n').includes('OU=' + teamID))
    throw new Error('The selected signing certificate belongs to another Developer Team.');
  const names = {
    development: /^(?:Apple Development:|Mac Developer:)/,
    distribution:
      /^(?:Apple Distribution:|3rd Party Mac Developer Application:|Mac App Distribution:)/,
    installer: /^(?:3rd Party Mac Developer Installer:|Mac Installer Distribution:)/,
  };
  if (!names[kind].test(selected[2]))
    throw new Error(
      'The selected certificate is not a ' +
        kind +
        ' Store certificate. Developer ID is a separate distribution channel.',
    );
  if (authorizedHashes && !authorizedHashes.includes(selected[1]))
    throw new Error(
      'The provisioning profile does not authorize this signing certificate. Regenerate the profile with the matching certificate.',
    );
  return { hash: selected[1], name: selected[2] };
}

async function main() {
  if (!['preflight', 'dev', 'distribution'].includes(command))
    throw new Error('Usage: pnpm mas:preflight, pnpm mas:dev, or pnpm mas:package');
  if (process.platform !== 'darwin')
    throw new Error('Store signing and profile validation must run on macOS.');
  const config = storeConfiguration.parse(
    JSON.parse(await readFile(path.join(directory, 'mac-app-store.json'), 'utf8')),
  );
  const inputs = storeInputs(process.env, channel);
  // Decode CMS in memory. Only this selected public summary is returned; the
  // full provisioning document, device IDs and certificate material are never logged.
  const decoded = execFileSync('/usr/bin/security', ['cms', '-D', '-i', inputs.profile], {
    maxBuffer: 4_000_000,
  });
  const profile = JSON.parse(
    run(
      'python3',
      [
        '-c',
        `import sys, plistlib, json, hashlib
p = plistlib.loads(sys.stdin.buffer.read())
e = p.get('Entitlements', {})
print(json.dumps(dict(
 teams=p.get('TeamIdentifier', []), platforms=p.get('Platform', []),
 expires=p['ExpirationDate'].isoformat() + 'Z',
 applicationIdentifier=e.get('com.apple.application-identifier', e.get('application-identifier', '')),
 applicationGroups=e.get('com.apple.security.application-groups', []),
 development=e.get('com.apple.security.get-task-allow', e.get('get-task-allow', False)),
 devices=p.get('ProvisionedDevices', []),
 certificateHashes=[hashlib.sha1(c).hexdigest().upper() for c in p.get('DeveloperCertificates', [])]
)))`,
      ],
      decoded,
    ),
  ) as ProfileSummary;
  const applicationIdentifier = validateStoreProfile(profile, config, channel);
  const signer = identity(
    inputs.identity,
    config.teamID,
    channel === 'mas-dev' ? 'development' : 'distribution',
    profile.certificateHashes,
  );
  let installer: ReturnType<typeof identity> | undefined;
  if (channel === 'mas') {
    if (!process.env.VIEWER_MAS_INSTALLER_IDENTITY)
      throw new Error(
        'Set VIEWER_MAS_INSTALLER_IDENTITY to a Mac Installer Distribution certificate for the same team.',
      );
    installer = identity(process.env.VIEWER_MAS_INSTALLER_IDENTITY, config.teamID, 'installer');
  } else {
    const hardware = JSON.parse(run('/usr/sbin/system_profiler', ['SPHardwareDataType', '-json']))
      .SPHardwareDataType?.[0];
    const device = hardware?.provisioning_udid ?? hardware?.platform_UUID;
    if (!device || !profile.devices.some((value) => value.toLowerCase() === device.toLowerCase()))
      throw new Error(
        'This Mac is not registered in the development profile. Add its provisioning UDID in Apple Developer and regenerate the profile.',
      );
  }
  const arch = process.env.VIEWER_MAS_ARCH ?? process.arch;
  if (arch !== 'arm64' && arch !== 'x64') throw new Error('VIEWER_MAS_ARCH must be arm64 or x64.');
  const entitlements = storeEntitlements(config, channel, applicationIdentifier);
  const entitlementDirectory = path.join(directory, 'out/mac-app-store/entitlements', channel);
  await mkdir(entitlementDirectory, { recursive: true });
  await Promise.all(
    Object.entries(entitlements).map(([name, value]) =>
      writeFile(path.join(entitlementDirectory, name + '.plist'), value, { mode: 0o600 }),
    ),
  );
  for (const name of Object.keys(entitlements))
    run('/usr/bin/plutil', ['-lint', path.join(entitlementDirectory, name + '.plist')]);
  console.log(
    JSON.stringify(
      {
        channel,
        team: config.teamID,
        bundle: config.bundleID,
        group: config.applicationGroup,
        build: inputs.build,
        arch,
        signer: signer.name,
        profileExpires: profile.expires,
        thisMacRegistered: channel === 'mas-dev',
      },
      null,
      2,
    ),
  );
  if (command === 'preflight') return;
  const env = {
    ...process.env,
    VIEWER_MAC_CHANNEL: channel,
    VIEWER_MAS_IDENTITY: signer.hash,
    VIEWER_BUILD_ARCH: arch,
  };
  // No shell interpolation, password export, Keychain mutation or Store upload.
  execFileSync('tsx', ['tools/build-helpers.ts'], { cwd: directory, env, stdio: 'inherit' });
  execFileSync('electron-forge', ['package', '--platform=mas', '--arch=' + arch], {
    cwd: directory,
    env,
    stdio: 'inherit',
  });
  const source = path.join(directory, 'out', 'Viewer-mas-' + arch, 'Viewer.app');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', source]);
  const output = path.join(directory, 'out/mac-app-store', channel, arch);
  const app = path.join(output, 'Viewer.app');
  await mkdir(output, { recursive: true });
  await rm(app, { recursive: true, force: true });
  await cp(source, app, { recursive: true, verbatimSymlinks: true });
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (installer) {
    const filename = 'Viewer-' + inputs.build + '-macOS-' + arch + '.pkg';
    const pkg = path.join(output, filename);
    await rm(pkg, { force: true });
    execFileSync(
      '/usr/bin/productbuild',
      ['--component', app, '/Applications', '--sign', installer.hash, pkg],
      { stdio: 'inherit' },
    );
    run('/usr/sbin/pkgutil', ['--check-signature', pkg]);
    await writeFile(
      path.join(output, 'SHA256SUMS.txt'),
      createHash('sha256')
        .update(await readFile(pkg))
        .digest('hex') +
        '  ' +
        filename +
        '\n',
    );
  }
  console.log(
    'Created ' +
      output +
      (channel === 'mas'
        ? '\nDistribution-signed MAS apps are for Store submission; they cannot be tested by launching them locally.'
        : '\nDevelopment build ready for testing on the registered Mac.'),
  );
}
await main().catch((error) => {
  console.error('Mac App Store build: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
