/**
 * A provisioning profile's property list is found by its own markers in the CMS envelope, within
 * bounds; its developer certificates are read with Node's X.509 parser. The signature is not
 * checked.
 */
import { describe, expect, it } from 'vitest';
import { readInspected } from '../src/desktop/previews/inspected';
import {
  provisionLimits,
  provisionPlist,
  readProvision,
} from '../src/domain/previews/data/provision';
import { inspectionSamples } from '../tools/playground/samples/inspection';

const samples = inspectionSamples();
const sampleBytes = (suffix: string) =>
  new Uint8Array(Buffer.from(samples.find((sample) => sample.path.endsWith(suffix))!.bytes));
const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>`;
const envelope = (text: string, before = 64) =>
  new Uint8Array(
    Buffer.concat([Buffer.alloc(before, 0x30), Buffer.from(text), Buffer.alloc(300, 0xa0)]),
  );

describe('provisioning profiles', () => {
  it('reads the playground profile: name, app ID, team, expiry, devices, entitlements, certificates', () => {
    const profile = readInspected('provision', sampleBytes('.mobileprovision'));
    expect(profile).toMatchObject({
      kind: 'provision',
      name: 'Viewer Sample Development',
      appID: 'EXAMPLE123.com.example.viewer-sample',
      appIDName: 'Viewer Sample',
      team: 'Viewer Playground',
      teamIDs: ['EXAMPLE123'],
      expires: '2036-01-01T00:00:00Z',
      platforms: ['iOS'],
      distribution: 'development',
      devices: 3,
      certificates: [
        {
          subject: 'Development: Viewer Sample (EXAMPLE123)',
          validTo: '2036-01-01T00:00:00.000Z',
        },
      ],
    });
    if (profile.kind !== 'provision') return;
    expect(profile.entitlements).toContainEqual({ key: 'get-task-allow', value: 'Yes' });
    expect(profile.entitlements).toContainEqual({
      key: 'keychain-access-groups',
      value: 'EXAMPLE123.*',
    });
  });

  it('reads a macOS profile for every device', () => {
    expect(readInspected('provision', sampleBytes('.provisionprofile'))).toMatchObject({
      platforms: ['macOS'],
      distribution: 'all-devices',
      devices: 0,
    });
  });

  it('tells ad hoc from App Store distribution', () => {
    const certificate = () => ({ subject: '' });
    const devices = '<key>ProvisionedDevices</key><array><string>1</string></array>';
    expect(readProvision(envelope(plist(devices)), certificate).distribution).toBe('ad-hoc');
    expect(
      readProvision(envelope(plist('<key>Name</key><string>Store</string>')), certificate),
    ).toMatchObject({
      name: 'Store',
      distribution: 'store',
      entitlements: [],
      certificates: [],
    });
  });

  it('bounds the search for the property list', () => {
    expect(() => provisionPlist(envelope(plist(''), provisionLimits.start + 1))).toThrow(
      'no property list',
    );
    expect(() => provisionPlist(envelope('<?xml version="1.0"?><plist><dict>'))).toThrow('no end');
    const long = plist(`<key>A</key><string>${'a'.repeat(provisionLimits.plist)}</string>`);
    expect(() => provisionPlist(envelope(long))).toThrow('no end');
    expect(() => provisionPlist(new Uint8Array(provisionLimits.bytes + 1))).toThrow('4 MB');
  });

  it('refuses a document type that declares entities', () => {
    const entity = `<?xml version="1.0"?><!DOCTYPE plist [<!ENTITY x "y">]><plist><dict><key>Name</key><string>&x;</string></dict></plist>`;
    expect(() => readProvision(envelope(entity), () => ({ subject: '' }))).toThrow();
  });
});
