import { appendFileSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { Duplex } from 'node:stream';
import { FakeSFTPServer } from './fake-sftp-server';
import { changedKeyStderr } from './ssh-error-samples';

const args = process.argv.slice(2);
const host = args[args.indexOf('--') + 1]!;
const command = args.includes('-O')
  ? args[args.indexOf('-O') + 1]!
  : args.includes('-s')
    ? 'sftp'
    : 'master';
const log = process.env.VIEWER_FAKE_SSH_LOG!;
appendFileSync(
  log,
  JSON.stringify({
    host,
    command,
    args,
    batch: args.includes('BatchMode=yes'),
    askpass: process.env.SSH_ASKPASS,
    tokenPresent: !!process.env.VIEWER_ASKPASS_TOKEN,
  }) + '\n',
  { mode: 0o600 },
);
interface Mode {
  failure?: string;
  prompt?: boolean;
  hostKey?: boolean;
  hang?: boolean;
  drop?: boolean;
  checkDrop?: boolean;
}
let mode: Mode = {};
try {
  mode = JSON.parse(readFileSync(log + '.mode', 'utf8')) as Mode;
} catch {
  /* Tests opt in to a failure mode. */
}
if (host === 'prompt-box') mode.prompt = true;
if (host === 'changed-box') mode.failure = changedKeyStderr;
if (host === 'auth-box') mode.failure = 'Permission denied (publickey,password).';
if (host === 'unreachable-box')
  mode.failure = 'ssh: connect to host unreachable-box port 22: Connection refused';

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
async function main(): Promise<void> {
  if (command === 'exit') return;
  if (command === 'check') {
    if (mode.checkDrop) process.exitCode = 255;
    return;
  }
  if (mode.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  if (mode.failure) {
    process.stderr.write(mode.failure);
    process.exitCode = 255;
    return;
  }
  if (command === 'master') {
    if (mode.prompt || mode.hostKey) {
      if (args.includes('BatchMode=yes') || !process.env.VIEWER_ASKPASS_TOKEN) {
        process.stderr.write('user@build-box: Permission denied (publickey,password).\n');
        process.exitCode = 255;
        return;
      }
      const answer = await ask(
        mode.hostKey
          ? "The authenticity of host 'build-box (192.0.2.10)' can't be established.\n" +
              'ED25519 key fingerprint is SHA256:dF7v73VCVA52XCCI0LR7unENWy9rIM/25/r7c9Hgh4g.\n' +
              'Are you sure you want to continue connecting (yes/no/[fingerprint])? '
          : 'Password:\u202e\u0007',
      );
      if (answer !== (mode.hostKey ? 'yes' : 'test answer')) {
        process.stderr.write('Permission denied, please try again.\n');
        process.exitCode = 255;
      }
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
