import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PreviewContext } from '../contracts';
import type { ProvisionDistribution } from '../../../domain/previews/data/provision';
import { Empty, Loading } from '../../ui/primitives';
import { PreviewToolbar } from '../controls';
import { dateText, useInspected } from '../useInspected';
import './inspection.css';

const distributions: Readonly<Record<ProvisionDistribution, string>> = {
  development: 'Development, on the listed devices',
  'ad-hoc': 'Ad hoc, on the listed devices',
  'all-devices': 'Any device: in-house or Developer ID',
  store: 'App Store',
};
const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;
const expired = (value: string | undefined, now: number) =>
  !!value && !Number.isNaN(Date.parse(value)) && Date.parse(value) < now;

function Facts({ facts }: { facts: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="inspection-facts">
      {facts.map(
        ([label, value]) =>
          value !== undefined &&
          value !== '' && (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ),
      )}
    </dl>
  );
}

/**
 * A provisioning profile: its app, team, expiry, devices, entitlements and the developer
 * certificates it names. The envelope's signature is not checked, and the preview says so.
 */
export default function ProvisionPreview(context: PreviewContext) {
  const inspection = useInspected(context, 'provision');
  const [now] = useState(() => Date.now());
  if (inspection.status === 'loading') return <Loading label="Reading profile…" />;
  if (inspection.status === 'failed')
    return (
      <Empty icon="warning" title="The profile could not be read" detail={inspection.message} />
    );
  const profile = inspection.file;
  const lapsed = expired(profile.expires, now);
  return (
    <div className="inspection-viewer">
      <PreviewToolbar context={context}>
        <span className="toolbar-spacer" />
        <span className="muted tabular">
          {profile.distribution === 'all-devices'
            ? 'All devices'
            : plural(profile.devices, 'device', 'devices')}{' '}
          · {plural(profile.entitlements.length, 'entitlement', 'entitlements')}
        </span>
      </PreviewToolbar>
      <div className="inspection-scroll">
        <p className="inspection-note">Viewer does not check this profile’s signature.</p>
        <article className="inspection-card" aria-label="Profile">
          <header>
            <h3>{profile.name || 'Untitled profile'}</h3>
            <span className={lapsed ? 'inspection-badge warning' : 'inspection-badge'}>
              {lapsed ? 'Expired' : 'Not expired'}
            </span>
          </header>
          {lapsed && <p className="inspection-warning">Expired on {dateText(profile.expires)}.</p>}
          <Facts
            facts={[
              ['App ID', <span className="inspection-mono">{profile.appID}</span>],
              ['App ID name', profile.appIDName],
              [
                'Team',
                [profile.team, profile.teamIDs.length ? `(${profile.teamIDs.join(', ')})` : '']
                  .filter(Boolean)
                  .join(' '),
              ],
              ['Distribution', distributions[profile.distribution]],
              ['Platforms', profile.platforms.join(', ')],
              ['Created', dateText(profile.created)],
              ['Expires', dateText(profile.expires)],
              [
                'Devices',
                profile.distribution === 'all-devices' ? 'All' : profile.devices.toLocaleString(),
              ],
              ['UUID', profile.uuid && <span className="inspection-mono">{profile.uuid}</span>],
            ]}
          />
        </article>
        <article className="inspection-card" aria-label="Entitlements">
          <header>
            <h3>Entitlements</h3>
          </header>
          {profile.entitlements.length ? (
            <dl className="inspection-facts">
              {profile.entitlements.map(({ key, value }) => (
                <div key={key}>
                  <dt className="inspection-mono">{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="inspection-note">The profile grants no entitlements.</p>
          )}
        </article>
        <article className="inspection-card" aria-label="Developer certificates">
          <header>
            <h3>Developer certificates</h3>
          </header>
          {profile.certificates.length ? (
            <ul className="inspection-list">
              {profile.certificates.map((certificate, index) => (
                <li key={index}>
                  <strong>{certificate.subject}</strong>
                  {certificate.validTo && (
                    <span
                      className={expired(certificate.validTo, now) ? 'inspection-warning' : 'muted'}
                    >
                      {expired(certificate.validTo, now) ? 'Expired on' : 'Expires'}{' '}
                      {dateText(certificate.validTo)}
                    </span>
                  )}
                  {certificate.sha1 && (
                    <span className="inspection-mono muted">SHA-1 {certificate.sha1}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="inspection-note">The profile names no developer certificates.</p>
          )}
        </article>
      </div>
    </div>
  );
}
