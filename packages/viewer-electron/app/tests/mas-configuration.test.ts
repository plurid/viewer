import { describe, expect, it } from 'vitest';
import store from '../mac-app-store.json' with { type: 'json' };
import {
  macChannel,
  storeChannel,
  provisioningDeviceID,
  storeConfiguration,
  storeEntitlements,
  storeInputs,
  validateStoreProfile,
  type ProfileSummary,
} from '../tools/mas-configuration';

const config = storeConfiguration.parse(store);
const profile: ProfileSummary = {
  teams: [config.teamID],
  platforms: ['OSX'],
  expires: '2030-01-01T00:00:00Z',
  applicationIdentifier: config.teamID + '.' + config.bundleID,
  applicationGroups: [config.applicationGroup],
  getTaskAllow: true,
  allDevices: false,
  devices: ['registered-test-mac'],
  certificateHashes: ['authorized-certificate'],
};
describe('Store release boundaries', () => {
  it('uses the Apple Silicon Provisioning UDID rather than the Hardware UUID', () => {
    const hardware = {
      platform_UUID: '11111111-2222-3333-4444-555555555555',
      provisioning_UDID: '00006020-0011223344556677',
    };
    expect(provisioningDeviceID(hardware)).toBe(hardware.provisioning_UDID);
    expect(provisioningDeviceID({ platform_UUID: hardware.platform_UUID })).toBe(
      hardware.platform_UUID,
    );
    expect(() => provisioningDeviceID({ ...hardware, provisioning_UDID: 'invalid' })).toThrow();
    expect(() => provisioningDeviceID({})).toThrow();
  });
  it('keeps direct-download and Store channels explicit and rejects inappropriate signing inputs', () => {
    expect(macChannel()).toBe('direct');
    expect(macChannel('mas-dev')).toBe('mas-dev');
    expect(macChannel('mas')).toBe('mas');
    expect(() => macChannel('ad-hoc-store')).toThrow();
    for (const identity of ['-', 'Developer ID Application: Team'])
      expect(() => storeInputs({ VIEWER_MAS_IDENTITY: identity }, 'mas-dev')).toThrow();
    expect(() =>
      storeInputs(
        {
          VIEWER_MAS_IDENTITY: 'Apple Development: Team',
          VIEWER_MAS_PROFILE: 'relative.provisionprofile',
          VIEWER_MAS_BUILD: '1',
        },
        'mas-dev',
      ),
    ).toThrow('absolute');
    expect(() =>
      storeInputs(
        {
          VIEWER_MAS_IDENTITY: 'Apple Development: Team',
          VIEWER_MAS_PROFILE: '/private/profile',
          VIEWER_MAS_BUILD: 'latest',
        },
        'mas-dev',
      ),
    ).toThrow('numeric');
  });
  it('builds the channel its command names, and refuses a conflicting VIEWER_MAC_CHANNEL (2026-10-20)', () => {
    // A VIEWER_MAC_CHANNEL=mas left exported made mas:dev a distribution build.
    expect(storeChannel('dev', {})).toBe('mas-dev');
    expect(storeChannel('distribution', {})).toBe('mas');
    expect(storeChannel('preflight', {})).toBe('mas-dev');
    expect(storeChannel('preflight', { VIEWER_MAC_CHANNEL: 'mas' })).toBe('mas');
    expect(storeChannel('dev', { VIEWER_MAC_CHANNEL: 'mas-dev' })).toBe('mas-dev');
    for (const [command, value] of [
      ['dev', 'mas'],
      ['distribution', 'mas-dev'],
      ['dev', 'direct'],
    ])
      expect(() => storeChannel(command!, { VIEWER_MAC_CHANNEL: value })).toThrow('conflicts');
  });
  it('requires a current, explicit macOS profile from the right team and channel', () => {
    expect(validateStoreProfile(profile, config, 'mas-dev')).toBe(profile.applicationIdentifier);
    const invalid: Partial<ProfileSummary>[] = [
      { teams: ['OTHERTEAM1'] },
      { platforms: ['iOS'] },
      { expires: '2020-01-01' },
      { applicationIdentifier: config.teamID + '.*' },
      { getTaskAllow: false },
      { allDevices: true },
      { devices: [] },
      { certificateHashes: [] },
    ];
    for (const value of invalid)
      expect(() => validateStoreProfile({ ...profile, ...value }, config, 'mas-dev')).toThrow();
    expect(() => validateStoreProfile(profile, config, 'mas')).toThrow('distribution');
    expect(
      validateStoreProfile({ ...profile, getTaskAllow: false, devices: [] }, config, 'mas'),
    ).toBe(profile.applicationIdentifier);
  });
  it('accepts team-prefixed macOS app groups without provisioning-profile group entries', () => {
    const unprovisionedGroup = { ...profile, applicationGroups: [] };
    expect(validateStoreProfile(unprovisionedGroup, config, 'mas-dev')).toBe(
      profile.applicationIdentifier,
    );
    expect(
      validateStoreProfile(
        { ...unprovisionedGroup, getTaskAllow: false, devices: [] },
        config,
        'mas',
      ),
    ).toBe(profile.applicationIdentifier);
    expect(() =>
      storeConfiguration.parse({ ...config, applicationGroup: 'group.' + config.bundleID }),
    ).toThrow();
  });
  it('accepts macOS profiles without the optional debug entitlement while rejecting unrestricted or device-bound distribution profiles', () => {
    const macDevelopment = { ...profile, getTaskAllow: null };
    expect(validateStoreProfile(macDevelopment, config, 'mas-dev')).toBe(
      profile.applicationIdentifier,
    );
    const macDistribution = { ...macDevelopment, devices: [] };
    expect(validateStoreProfile(macDistribution, config, 'mas')).toBe(
      profile.applicationIdentifier,
    );
    expect(() => validateStoreProfile(macDevelopment, config, 'mas')).toThrow('distribution');
    expect(() => validateStoreProfile({ ...profile, allDevices: true }, config, 'mas-dev')).toThrow(
      'Developer ID',
    );
    expect(() =>
      validateStoreProfile({ ...macDistribution, allDevices: true }, config, 'mas'),
    ).toThrow('Developer ID');
  });
  it('uses the profile’s App ID prefix while retaining the actual team and separates inheriting helper rights', () => {
    const application = 'OTHERPRE01.' + config.bundleID;
    const value = validateStoreProfile(
      { ...profile, applicationIdentifier: application },
      config,
      'mas-dev',
    );
    const development = storeEntitlements(config, 'mas-dev', value);
    expect(development.main).toContain('<string>' + application + '</string>');
    expect(development.main).toContain(
      '<key>com.apple.developer.team-identifier</key><string>' + config.teamID + '</string>',
    );
    expect(development.main).toContain('com.apple.security.files.bookmarks.app-scope');
    expect(development.main).toContain('com.apple.security.get-task-allow');
    expect(storeEntitlements(config, 'mas', application).main).not.toContain('get-task-allow');
    expect(
      [...development.inherit.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]),
    ).toEqual(['com.apple.security.app-sandbox', 'com.apple.security.inherit']);
    expect(() =>
      storeConfiguration.parse({ ...config, applicationGroup: 'OTHERTEAM1.' + config.bundleID }),
    ).toThrow();
  });
});
