import type { XMLNode } from './xml';
import { parseXML } from './xml';
import { xmlPlistValue } from './plist';
import { base64Bytes } from '../keys/certificates';

/**
 * An Apple provisioning profile: a CMS-signed envelope around an XML property list. The list is
 * found by its own markers in the envelope's bytes; the signature is not checked.
 */
/** iOS and visionOS profiles, and macOS ones. */
export const provisionFormats = ['mobileprovision', 'provisionprofile'] as const;
export const provisionLimits = {
  bytes: 4 * 1024 * 1024,
  /** Where the property list must start: the envelope's header comes before it. */
  start: 64 * 1024,
  plist: 2 * 1024 * 1024,
  certificates: 100,
} as const;

/** Who the profile lets install the app. */
export type ProvisionDistribution = 'development' | 'ad-hoc' | 'all-devices' | 'store';

export interface ProvisionCertificate {
  subject: string;
  validTo?: string;
  sha1?: string;
}

export interface ProvisionFacts {
  kind: 'provision';
  name: string;
  appID: string;
  appIDName?: string;
  team: string;
  teamIDs: string[];
  uuid?: string;
  created?: string;
  expires?: string;
  platforms: string[];
  distribution: ProvisionDistribution;
  devices: number;
  entitlements: { key: string; value: string }[];
  certificates: ProvisionCertificate[];
}

const latin1 = new TextDecoder('latin1');
/** Where an ASCII marker first occurs in `bytes`, from `from` up to `to`. */
function find(bytes: Uint8Array, marker: string, from: number, to: number): number {
  const first = marker.charCodeAt(0);
  const end = Math.min(bytes.length, to) - marker.length;
  for (let at = bytes.indexOf(first, from); at >= 0 && at <= end; at = bytes.indexOf(first, at + 1))
    if (latin1.decode(bytes.subarray(at, at + marker.length)) === marker) return at;
  return -1;
}

/** The XML property list inside a profile's envelope. */
export function provisionPlist(bytes: Uint8Array): string {
  if (bytes.length > provisionLimits.bytes)
    throw new Error('The provisioning profile is larger than 4 MB.');
  let start = find(bytes, '<?xml', 0, provisionLimits.start);
  if (start < 0) start = find(bytes, '<plist', 0, provisionLimits.start);
  if (start < 0) throw new Error('This file holds no property list.');
  const close = find(bytes, '</plist>', start, start + provisionLimits.plist);
  if (close < 0) throw new Error('The property list has no end, or is larger than 2 MB.');
  return new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(start, close + '</plist>'.length),
  );
}

const elements = (node: XMLNode) =>
  node.children.filter((child): child is XMLNode => typeof child !== 'string');
const content = (node: XMLNode) =>
  node.children.filter((child) => typeof child === 'string').join('');

/** The DER bytes of each certificate the top dictionary's DeveloperCertificates array holds. */
function developerCertificates(text: string): Uint8Array[] {
  const root = parseXML(new TextEncoder().encode(text.replace(/<!DOCTYPE plist\s[^[>]*>/, '')));
  const top = elements(root)[0];
  if (top?.name !== 'dict') return [];
  const children = elements(top);
  const at = children.findIndex(
    (child, index) =>
      index % 2 === 0 && child.name === 'key' && content(child) === 'DeveloperCertificates',
  );
  const array = children[at + 1];
  if (at < 0 || array?.name !== 'array') return [];
  return elements(array)
    .filter((child) => child.name === 'data')
    .slice(0, provisionLimits.certificates)
    .flatMap((child) => {
      const bytes = base64Bytes(content(child));
      return bytes ? [bytes] : [];
    });
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const optional = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const platformNames: Readonly<Record<string, string>> = { OSX: 'macOS', xrOS: 'visionOS' };

/** An entitlement's value as a person reads it. */
export function entitlementText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(entitlementText).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * What a profile says: its app, team, expiry, devices, entitlements and developer certificates,
 * each read by `certificate`. The envelope's signature is not checked.
 */
export function readProvision(
  bytes: Uint8Array,
  certificate: (der: Uint8Array) => ProvisionCertificate,
): ProvisionFacts {
  const text = provisionPlist(bytes);
  const value = xmlPlistValue(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The property list is not a profile.');
  const plist = value as Record<string, unknown>;
  const entitlements =
    plist.Entitlements && typeof plist.Entitlements === 'object'
      ? (plist.Entitlements as Record<string, unknown>)
      : {};
  const devices = strings(plist.ProvisionedDevices).length;
  const distribution: ProvisionDistribution =
    plist.ProvisionsAllDevices === true
      ? 'all-devices'
      : devices
        ? entitlements['get-task-allow'] === true
          ? 'development'
          : 'ad-hoc'
        : 'store';
  return {
    kind: 'provision',
    name: optional(plist.Name) ?? '',
    appID:
      optional(entitlements['application-identifier']) ??
      optional(entitlements['com.apple.application-identifier']) ??
      '',
    appIDName: optional(plist.AppIDName),
    team: optional(plist.TeamName) ?? '',
    teamIDs: strings(plist.TeamIdentifier),
    uuid: optional(plist.UUID),
    created: optional(plist.CreationDate),
    expires: optional(plist.ExpirationDate),
    platforms: strings(plist.Platform).map((name) => platformNames[name] ?? name),
    distribution,
    devices,
    entitlements: Object.entries(entitlements).map(([key, item]) => ({
      key,
      value: entitlementText(item),
    })),
    certificates: developerCertificates(text).map(certificate),
  };
}
