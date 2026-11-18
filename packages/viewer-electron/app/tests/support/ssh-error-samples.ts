import type { SSHFailureState } from '../../src/domain/remote/ssh-errors';

// Standard error of OpenSSH 9.x at LogLevel=ERROR, from its source messages with fixture names
// (build-box, 192.0.2.10, /fixtures): sshconnect.c warn_changed_key, check_host_key and
// ssh_connect_direct; sshconnect2.c userauth and identity_sign; ssh.c resolve_host; kex.c
// kex_exchange_identification; packet.c. https://github.com/openssh/openssh-portable/tree/V_9_9_P2
// The line endings and the unknown-key wording match a review run against a loopback sshd: ssh
// ends lines with CRLF, except the one inside the changed-key fingerprint.

export const fixtureFingerprint = 'SHA256:dF7v73VCVA52XCCI0LR7unENWy9rIM/25/r7c9Hgh4g';

const banner = (title: string) =>
  [
    '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    title,
    '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  ].join('\r\n');

export const changedKeyStderr = [
  banner('@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @'),
  'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
  'Someone could be eavesdropping on you right now (man-in-the-middle attack)!',
  'It is also possible that a host key has just been changed.',
  'The fingerprint for the ED25519 key sent by the remote host is\n' + fixtureFingerprint + '.',
  'Please contact your system administrator.',
  'Add correct host key in /fixtures/home/.ssh/known_hosts to get rid of this message.',
  'Offending ED25519 key in /fixtures/home/.ssh/known_hosts:3',
  'Host key for build-box has changed and you have requested strict checking.',
  'Host key verification failed.',
  '',
].join('\r\n');

/** CRLF everywhere, except after "remote host is", where ssh writes a bare line feed. */
const crlf = (text: string) => text.replace(/(?<!\r|remote host is)\n/g, '\r\n');

const samples: [string, string, SSHFailureState][] = [
  ['changed key', changedKeyStderr, 'host-key-changed'],
  [
    'revoked key',
    [
      banner('@       WARNING: REVOKED HOST KEY DETECTED!               @'),
      'The ED25519 host key for build-box is marked as revoked.',
      'This could mean that a stolen key is being used to',
      'impersonate this host.',
      'Host key verification failed.',
      '',
    ].join('\n'),
    'host-key-changed',
  ],
  [
    'changed key and unknown address',
    [
      banner('@       WARNING: POSSIBLE DNS SPOOFING DETECTED!          @'),
      'The ED25519 host key for build-box has changed,',
      'and the key for the corresponding IP address 192.0.2.10',
      'is unknown. This could either mean that',
      'DNS SPOOFING is happening or the IP address for the host',
      'and its host key have changed at the same time.',
      changedKeyStderr,
    ].join('\n'),
    'host-key-changed',
  ],
  ['unknown host key without a prompt', 'Host key verification failed.\r\n', 'needs-sign-in'],
  [
    'unknown host key, older wording',
    'No ED25519 host key is known for build-box and you have requested strict checking.\r\n' +
      'Host key verification failed.\r\n',
    'needs-sign-in',
  ],
  [
    'authentication',
    'builder@build-box: Permission denied (publickey,password).\n',
    'needs-sign-in',
  ],
  [
    'too many keys offered',
    'Received disconnect from 192.0.2.10 port 22:2: Too many authentication failures\n' +
      'Disconnected from 192.0.2.10 port 22\n',
    'needs-sign-in',
  ],
  [
    'agent declined to sign',
    'sign_and_send_pubkey: signing failed for ED25519 "/fixtures/home/.ssh/id_ed25519" from agent: agent refused operation\n' +
      'builder@build-box: Permission denied (publickey).\n',
    'needs-sign-in',
  ],
  ['refused', 'ssh: connect to host build-box port 22: Connection refused\n', 'unreachable'],
  ['timeout', 'ssh: connect to host build-box port 22: Operation timed out\n', 'unreachable'],
  ['no route', 'ssh: connect to host 192.0.2.10 port 22: No route to host\n', 'unreachable'],
  [
    'DNS',
    'ssh: Could not resolve hostname build-box: nodename nor servname provided, or not known\n',
    'unreachable',
  ],
  [
    'reset during identification',
    'kex_exchange_identification: read: Connection reset by peer\n' +
      'Connection reset by 192.0.2.10 port 22\n',
    'unreachable',
  ],
  [
    'jump host cannot reach the server',
    'channel 0: open failed: connect failed: Name or service not known\n' +
      'stdio forwarding failed\n' +
      'kex_exchange_identification: Connection closed by remote host\n' +
      'Connection closed by UNKNOWN port 65535\n',
    'unreachable',
  ],
  [
    'no shared algorithm',
    'Unable to negotiate with 192.0.2.10 port 22: no matching host key type found. Their offer: ssh-rsa\n',
    'unreachable',
  ],
  [
    'banner timeout',
    'Connection timed out during banner exchange\nConnection to 192.0.2.10 port 22 timed out\n',
    'unreachable',
  ],
];

export const sshErrorSamples: [string, string, SSHFailureState][] = samples.map(
  ([name, text, state]) => [name, crlf(text), state],
);
