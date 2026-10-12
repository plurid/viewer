import path from 'node:path';
import { z } from 'zod';

export const storeConfiguration = z
  .object({
    teamID: z.string().regex(/^[A-Z0-9]{10}$/),
    bundleID: z.string().regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/),
    applicationGroup: z.string().min(1),
  })
  .strict()
  .refine(
    (value) => value.applicationGroup.startsWith(value.teamID + '.'),
    'The application group must belong to the Developer Team.',
  );
export type StoreConfiguration = z.infer<typeof storeConfiguration>;
export type StoreChannel = 'mas-dev' | 'mas';
export function macChannel(value?: string): 'direct' | StoreChannel {
  if (!value || value === 'direct') return 'direct';
  if (value === 'mas-dev' || value === 'mas') return value;
  throw new Error('VIEWER_MAC_CHANNEL must be direct, mas-dev, or mas.');
}
export function storeInputs(env: NodeJS.ProcessEnv, channel: StoreChannel) {
  const identity = env.VIEWER_MAS_IDENTITY?.trim();
  const profile = env.VIEWER_MAS_PROFILE?.trim();
  const build = env.VIEWER_MAS_BUILD?.trim();
  if (!identity || identity === '-' || /Developer ID/i.test(identity))
    throw new Error(
      'Set VIEWER_MAS_IDENTITY to a valid ' +
        (channel === 'mas-dev'
          ? 'Apple Development'
          : 'Apple Distribution / Mac App Distribution') +
        ' signing identity for the configured team. Ad-hoc and Developer ID signatures cannot be used for a Store build.',
    );
  if (!profile || !path.isAbsolute(profile))
    throw new Error(
      'Set VIEWER_MAS_PROFILE to an absolute path to a macOS provisioning profile for Viewer. An iOS profile cannot be reused.',
    );
  if (!build || !/^\d+(?:\.\d+){0,2}$/.test(build))
    throw new Error('Set VIEWER_MAS_BUILD to a unique numeric Store build number (for example 1).');
  return { identity, profile, build };
}

export interface ProfileSummary {
  teams: string[];
  platforms: string[];
  expires: string;
  applicationIdentifier: string;
  applicationGroups: string[];
  development: boolean;
  devices: string[];
  certificateHashes: string[];
}
export function validateStoreProfile(
  profile: ProfileSummary,
  config: StoreConfiguration,
  channel: StoreChannel,
  now = new Date(),
) {
  if (!profile.teams.includes(config.teamID))
    throw new Error('The provisioning profile belongs to a different Developer Team.');
  if (!profile.platforms.includes('OSX'))
    throw new Error('Viewer needs a macOS profile, not an iOS or other platform profile.');
  if (!Number.isFinite(Date.parse(profile.expires)) || Date.parse(profile.expires) <= now.getTime())
    throw new Error('The provisioning profile has expired.');
  const suffix = '.' + config.bundleID;
  if (
    !profile.applicationIdentifier.endsWith(suffix) ||
    !/^[A-Z0-9]{10}$/.test(profile.applicationIdentifier.slice(0, -suffix.length))
  )
    throw new Error(
      'Register Viewer’s explicit bundle ID and choose its matching provisioning profile. Wildcard profiles are unsupported.',
    );
  if (!profile.applicationGroups.includes(config.applicationGroup))
    throw new Error(
      'The provisioning profile must authorize Viewer’s application group: ' +
        config.applicationGroup,
    );
  if (profile.development !== (channel === 'mas-dev'))
    throw new Error(
      'Choose a ' +
        (channel === 'mas-dev' ? 'development' : 'Mac App Store distribution') +
        ' provisioning profile for this build channel.',
    );
  if (channel === 'mas-dev' && !profile.devices.length)
    throw new Error('The development profile must include a registered test Mac.');
  if (!profile.certificateHashes.length)
    throw new Error('The provisioning profile has no authorized signing certificates.');
  return profile.applicationIdentifier;
}

const xml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const plist = (body: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n' +
  body +
  '</dict></plist>\n';
export function storeEntitlements(
  config: StoreConfiguration,
  channel: StoreChannel,
  applicationIdentifier: string,
) {
  return {
    main: plist(
      '<key>com.apple.security.app-sandbox</key><true/>\n' +
        '<key>com.apple.security.files.user-selected.read-write</key><true/>\n' +
        '<key>com.apple.security.files.bookmarks.app-scope</key><true/>\n' +
        '<key>com.apple.security.network.client</key><true/>\n' +
        '<key>com.apple.security.network.server</key><true/>\n' +
        '<key>com.apple.security.cs.allow-jit</key><true/>\n' +
        '<key>com.apple.application-identifier</key><string>' +
        xml(applicationIdentifier) +
        '</string>\n' +
        '<key>com.apple.developer.team-identifier</key><string>' +
        xml(config.teamID) +
        '</string>\n' +
        '<key>com.apple.security.application-groups</key><array><string>' +
        xml(config.applicationGroup) +
        '</string></array>\n' +
        (channel === 'mas-dev' ? '<key>com.apple.security.get-task-allow</key><true/>\n' : ''),
    ),
    // Sandboxed executable children inherit static rights. Only these two
    // sandbox keys are allowed in an inheriting helper's own entitlements.
    inherit: plist(
      '<key>com.apple.security.app-sandbox</key><true/>\n<key>com.apple.security.inherit</key><true/>\n',
    ),
  };
}
