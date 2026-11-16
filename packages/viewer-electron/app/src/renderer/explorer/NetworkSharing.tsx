import { useEffect, useState } from 'react';
import type { NetworkShare, NetworkSharingSnapshot } from '../../domain/files/network-sharing';
import { guestWarning, sharingAddresses, sharingServiceText } from '../../domain/files/network-sharing';
import { errorMessage } from '../../domain/errors';
import { Button, CopyButton, Dialog, PathField } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { followNetworkSharing, networkSharingEnabled, refreshNetworkSharing, sharedFolder, useNetworkSharing } from './network-sharing-state';
import './network-sharing.css';

export function SharedMark({ path }: { path: string }) {
  const snapshot = useNetworkSharing();
  const share = sharedFolder(path);
  if (!share) return null;
  const description = [`Shared as ${share.name}.`, sharingServiceText(snapshot.service), guestWarning(share)].filter(Boolean).join(' ');
  return <span className="network-shared-mark" role="img" aria-label="Shared" aria-description={description} title={description}><Icon name="network" size={11} /></span>;
}

function ShareDetails({ share, snapshot }: { share: NetworkShare; snapshot: NetworkSharingSnapshot }) {
  const warning = guestWarning(share);
  const addresses = sharingAddresses(share, snapshot.host, snapshot.ipv4);
  return <>
    <dl className="network-sharing-details">
      <dt>Share name</dt><dd>{share.name}</dd>
      <dt>Who can connect</dt><dd>{share.guests ? 'Registered users and guests' : 'Registered users only'}</dd>
      <dt>Access</dt><dd>{share.readOnly ? 'Read-only' : 'Read and write, subject to folder permissions'}</dd>
    </dl>
    {warning && <p className="network-sharing-warning">{warning}</p>}
    <p>{sharingServiceText(snapshot.service)}</p>
    {addresses.length ? <ul className="network-sharing-addresses">{addresses.map(({ system, address }) => <li key={address}>
      <span>{system}</span>
      <span className="network-sharing-address"><span>{address}</span><CopyButton copy={{ text: address }} label={`Copy ${system} address ${address}`} /></span>
    </li>)}</ul> : <p className="muted">No local network address is available. Connect this Mac to the local network.</p>}
  </>;
}

export function NetworkSharingSection({ path }: { path: string }) {
  const snapshot = useNetworkSharing();
  useEffect(() => followNetworkSharing(), []);
  const shares = networkSharingEnabled() && snapshot.status === 'ready'
    ? snapshot.shares.filter((share) => share.path === path) : [];
  if (!shares.length) return null;
  return <section className="network-sharing-section" aria-label="Network sharing">
    <h3>Network sharing</h3>
    {shares.map((share) => <ShareDetails key={share.name} share={share} snapshot={snapshot} />)}
    <Button variant="secondary" onClick={refreshNetworkSharing}>Refresh sharing</Button>
  </section>;
}

export function NetworkSharingDialog({ path, onClose }: { path: string; onClose(): void }) {
  const snapshot = useNetworkSharing();
  const [error, setError] = useState('');
  useEffect(() => followNetworkSharing(), []);
  const shares = snapshot.status === 'ready' ? snapshot.shares.filter((share) => share.path === path) : [];
  return <Dialog title="Network sharing" onClose={onClose} className="network-sharing-dialog">
    <div className="network-sharing-body">
      <p>Use macOS File Sharing to let another computer open this folder. Viewer opens System Settings; you choose whether to share it there.</p>
      <PathField path={path} label="Copy folder path" />
      <ol>
        <li>In System Settings, open General, then Sharing. Turn File Sharing on and open its information button.</li>
        <li>Under Shared Folders, click + and choose this folder. To stop sharing, select it there and click the remove button.</li>
        <li>Choose who can connect and whether they can read or write. Turn “Allow guest users” off unless you mean to share with everyone on the network.</li>
      </ol>
      <div role="status" aria-live="polite">
        {snapshot.status === 'ready' ? shares.length
          ? <><p>This folder is shared.</p>{shares.map((share) => <ShareDetails key={share.name} share={share} snapshot={snapshot} />)}</>
          : <p>This folder is not shared.</p>
          : <p className="muted">Sharing status is unknown.</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    <footer>
      <Button variant="secondary" onClick={refreshNetworkSharing}>Refresh</Button>
      <Button variant="quiet" onClick={onClose}>Done</Button>
      <Button variant="primary" onClick={() => {
        setError('');
        void window.viewer.networkSharing({ kind: 'settings', path }).catch((cause: unknown) => setError(errorMessage(cause)));
      }}>Open File Sharing Settings</Button>
    </footer>
  </Dialog>;
}
