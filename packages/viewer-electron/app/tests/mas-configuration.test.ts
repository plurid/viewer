import { describe, expect, it } from 'vitest';
import {
  macChannel,
  storeConfiguration,
  storeEntitlements,
  storeInputs,
  validateStoreProfile,
  type ProfileSummary,
} from '../tools/mas-configuration';

const config = storeConfiguration.parse({
  teamID: '49W9L8Z9J5',
  bundleID: 'com.plurid.viewer',
  applicationGroup: '49W9L8Z9J5.com.plurid.viewer',
});
const profile: ProfileSummary = {
  teams: [config.teamID],
  platforms: ['OSX'],
  expires: '2030-01-01T00:00:00Z',
  applicationIdentifier: '49W9L8Z9J5.com.plurid.viewer',
  applicationGroups: [config.applicationGroup],
  development: true,
  devices: ['registered-test-mac'],
  certificateHashes: ['authorized-certificate'],
};
describe('Store release boundaries', () => {
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
  it('requires a current, explicit macOS profile from the right team, channel and application group', () => {
    expect(validateStoreProfile(profile, config, 'mas-dev')).toBe(profile.applicationIdentifier);
    const invalid: Partial<ProfileSummary>[] = [
      { teams: ['OTHERTEAM1'] },
      { platforms: ['iOS'] },
      { expires: '2020-01-01' },
      { applicationIdentifier: config.teamID + '.*' },
      { applicationGroups: [] },
      { development: false },
      { devices: [] },
      { certificateHashes: [] },
    ];
    for (const value of invalid)
      expect(() => validateStoreProfile({ ...profile, ...value }, config, 'mas-dev')).toThrow();
    expect(() => validateStoreProfile(profile, config, 'mas')).toThrow('distribution');
    expect(
      validateStoreProfile({ ...profile, development: false, devices: [] }, config, 'mas'),
    ).toBe(profile.applicationIdentifier);
  });
  it('uses the profile’s App ID prefix while retaining the actual team and separates inheriting helper rights', () => {
    const application = 'OTHERPRE01.com.plurid.viewer';
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
      storeConfiguration.parse({ ...config, applicationGroup: 'OTHERTEAM1.com.plurid.viewer' }),
    ).toThrow();
  });
});
