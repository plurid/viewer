import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { Duplex } from 'node:stream';
import { FakeSFTPServer } from './fake-sftp-server';
import { changedKeyStderr } from './ssh-error-samples';

// A stand-in for /usr/bin/ssh that never touches the network. It logs its argv and keeps the
// masters it "started" in a state file beside the log, as OpenSSH keeps them behind their
// control sockets: a master started with `-M` as well as ControlMaster=yes runs in `ask` mode,
// which refuses sessions and `-O exit` without a confirmation, as the real one does.

type MasterMode = 'running' | 'ask' | 'gone';

const args = process.argv.slice(2);
const host = args[args.indexOf('--') + 1]!;
const controlPath = args[args.indexOf('-S') + 1]!;
const command = args.includes('-O')
  ? args[args.indexOf('-O') + 1]!
  : args.includes('-s')
    ? 'sftp'
    : 'master';
const log = process.env.VIEWER_FAKE_SSH_LOG!;
const stateFile = log + '.masters';
// OpenSSH writes CRLF line endings to standard error.
const fail = (message: string) => {
  process.stderr.write(message.replace(/\r?\n/g, '\r\n'));
  process.exitCode = 255;
};

interface Mode {
  failure?: string;
  prompt?: boolean;
  hostKey?: boolean;
  hang?: boolean;
  drop?: boolean;
  /** The master has ended: checks fail and channels find no socket. */
  checkDrop?: boolean;
  /** `ssh -f` exits 0 but never created the socket. */
  noSocket?: boolean;
}

let mode: Mode = {};
try {
  mode = JSON.parse(readFileSync(log + '.mode', 'utf8')) as Mode;
} catch {
  /* Tests opt in to a failure mode. */
}
if (host === 'prompt-box') mode.prompt = true;
if (host === 'changed-box') mode.failure = changedKeyStderr;
if (host === 'auth-box') mode.failure = 'Permission denied (publickey,password).\n';
if (host === 'unreachable-box')
  mode.failure = 'ssh: connect to host unreachable-box port 22: Connection refused\n';

function masters(): Record<string, MasterMode> {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, MasterMode>;
  } catch {
    return {};
  }
}

function setMaster(value: MasterMode): void {
  writeFileSync(stateFile, JSON.stringify({ ...masters(), [controlPath]: value }), { mode: 0o600 });
}

const option = (name: string) =>
  args.find((value) => value.startsWith(name + '='))?.slice(name.length + 1);
const askMode =
  args.includes('-M') && ['yes', 'ask', 'auto', 'autoask'].includes(option('ControlMaster') ?? '');
const master: MasterMode | undefined = mode.checkDrop ? 'gone' : masters()[controlPath];

appendFileSync(
  log,
  JSON.stringify({
    host,
    command,
    args,
    batch: args.includes('BatchMode=yes'),
    askpass: process.env.SSH_ASKPASS,
    tokenPresent: !!process.env.VIEWER_ASKPASS_TOKEN,
    environment: Object.keys(process.env).sort(),
    ...(command === 'master' ? { controlMaster: askMode ? 'ask' : option('ControlMaster') } : {}),
  }) + '\n',
  { mode: 0o600 },
);

async function ask(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = connect(process.env.VIEWER_ASKPASS_SOCKET!);
    let input = '';
    socket.on('connect', () =>
      socket.write(JSON.stringify({ token: process.env.VIEWER_ASKPASS_TOKEN, prompt }) + '\n'),
    );
    socket.on('data', (bytes: Buffer) => {
      input += bytes.toString('utf8');
      if (input.includes('\n')) {
        socket.end();
        resolve((JSON.parse(input) as { answer: string | null }).answer);
      }
    });
    socket.on('error', () => resolve(null));
    socket.on('end', () => {
      if (!input) resolve(null);
    });
  });
}

/** What ssh does with no usable master: sign in directly, unless a ProxyCommand stops it. */
function direct(): boolean {
  if (option('ProxyCommand') === '/usr/bin/false') {
    fail('kex_exchange_identification: Connection closed by remote host\n');
    return false;
  }
  appendFileSync(log, JSON.stringify({ host, command: 'direct-sign-in' }) + '\n');
  return true;
}

async function main(): Promise<void> {
  if (command === 'exit') {
    if (master === 'ask') {
      fail('Master refused termination request: Permission denied\n');
    } else if (master === 'running') {
      setMaster('gone');
      process.stderr.write('Exit request sent.\r\n');
    } else {
      fail('Control socket connect(' + controlPath + '): No such file or directory\n');
    }
    return;
  }
  if (command === 'check') {
    if (master === 'running' || master === 'ask') {
      process.stderr.write('Master running (pid=4194301)\r\n');
    } else {
      fail('Control socket connect(' + controlPath + '): No such file or directory\n');
    }
    return;
  }
  if (mode.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  if (command === 'sftp') {
    if (master === 'ask') {
      process.stderr.write('Master refused session request: Permission denied\r\n');
      if (!direct()) return;
    } else if (master !== 'running' && !direct()) {
      return;
    }
  }
  if (mode.failure) {
    fail(mode.failure);
    return;
  }
  if (command === 'master') {
    if (mode.prompt || mode.hostKey) {
      if (args.includes('BatchMode=yes') || !process.env.VIEWER_ASKPASS_TOKEN) {
        fail('user@build-box: Permission denied (publickey,password).\n');
        return;
      }
      const answer = await ask(
        mode.hostKey
          ? "The authenticity of host 'build-box (192.0.2.10)' can't be established.\n" +
              'ED25519 key fingerprint is SHA256:dF7v73VCVA52XCCI0LR7unENWy9rIM/25/r7c9Hgh4g.\n' +
              'Are you sure you want to continue connecting (yes/no/[fingerprint])? '
          : 'Password:‮\u0007',
      );
      if (answer !== (mode.hostKey ? 'yes' : 'test answer')) {
        fail('Permission denied, please try again.\n');
        return;
      }
    }
    if (!mode.noSocket) {
      setMaster(askMode ? 'ask' : 'running');
    }
    return;
  }
  const transport = new Duplex({
    read() {
      process.stdin.resume();
    },
    write(bytes, encoding, callback) {
      process.stdout.write(bytes, encoding, callback);
    },
  });
  process.stdin.on('data', (bytes: Buffer) => {
    if (!transport.push(bytes)) process.stdin.pause();
  });
  process.stdin.on('end', () => {
    transport.push(null);
    server.stop();
  });
  transport.on('error', () => {});
  const server = new FakeSFTPServer(transport);
  server.directory('/home/user');
  server.file('/hello.txt', Buffer.from('hello from a fake server'));
  if (mode.drop) setTimeout(() => process.exit(255), 80);
  process.on('exit', () => server.assertSafePackets());
}
void main().catch(() => {
  process.exitCode = 1;
});
