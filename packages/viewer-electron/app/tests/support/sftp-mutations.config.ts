import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base from '../../vitest.config.ts';

interface MutationEdit {
  file: string;
  before: string | RegExp;
  after: string;
}

const codec = '/src/desktop/remote/sftp/codec.ts';
const client = '/src/desktop/remote/sftp/client.ts';
const streams = '/src/desktop/remote/sftp/streams.ts';
const errors = '/src/desktop/remote/sftp/errors.ts';
const fixture = '/tests/support/fake-sftp-server.ts';
const edit = (file: string, before: string | RegExp, after: string): MutationEdit => ({
  file,
  before,
  after,
});
const readWindow = edit(
  streams,
  'if (reserved + length > remoteLimits.readBytesPerStream) break;',
  '',
);
const writeWindow = edit(
  streams,
  'reserved + data.length > remoteLimits.readBytesPerStream',
  'false',
);
const concurrency = edit(
  streams,
  'concurrency: Math.min(concurrency, remoteLimits.requestsPerChannel),',
  'concurrency,',
);
const trailing = edit(
  client,
  "await this.operation({ kind: 'rename', from, to }, 'status', options);",
  "await this.operation({ kind: 'rename', from, to }, 'status', options);\nthis.transport.write(Buffer.from([0,0,0,9,13,0,0,0,99,0,0,0,0]));",
);

/** Rebased semantic equivalents of the review probes; no repository file is rewritten. */
export const sftpMutations: Record<string, readonly MutationEdit[]> = {
  openNoExcl: [
    edit(codec, "request.mode === 'read' ? 1 : 2 | 8 | 32", "request.mode === 'read' ? 1 : 2 | 8"),
  ],
  openTrunc: [
    edit(
      codec,
      "request.mode === 'read' ? 1 : 2 | 8 | 32",
      "request.mode === 'read' ? 1 : 2 | 8 | 16 | 32",
    ),
  ],
  setstatAnyKey: [
    edit(
      codec,
      "Object.keys(attrs).every((key) => key === 'permissions' || key === 'times')",
      'true',
    ),
  ],
  renameAsRemove: [
    edit(
      codec,
      'const writer = new SFTPWriter().byte(type).uint32(id);',
      "const writer = new SFTPWriter().byte(request.kind === 'rename' ? 0xd : type).uint32(id);",
    ),
  ],
  mkdirAsRmdir: [
    edit(
      codec,
      'const writer = new SFTPWriter().byte(type).uint32(id);',
      "const writer = new SFTPWriter().byte(request.kind === 'mkdir' ? 0xf : type).uint32(id);",
    ),
  ],
  copyAsPosixRename: [
    edit(codec, "copyData: 'copy-data',", "copyData: 'posix-' + 'rename@openssh.com',"),
  ],
  deadRemoveEncoder: [
    edit(
      codec,
      'export function decodeClientPacket(',
      'export function encodeUnlink(id: number, file: Buffer): Buffer { return framed(new SFTPWriter().byte(0xd).uint32(id).string(file)); }\nexport function decodeClientPacket(',
    ),
  ],
  symlinkSwapped: [
    edit(
      codec,
      'writer.string(request.target).string(request.path);',
      'writer.string(request.path).string(request.target);',
    ),
  ],
  noTrailingCheck: [edit(codec, '  reader.end();\n  return reply;', '  return reply;')],
  noNameCount: [
    edit(codec, "protocolAssert(count <= remoteLimits.namesPerReply, 'Too many SFTP names.');", ''),
  ],
  noStringLimit: [edit(codec, "protocolAssert(length <= limit, 'Oversized SFTP string.');", '')],
  nameLimitAsString: [
    edit(codec, 'filename: reader.string(sftpBounds.nameBytes),', 'filename: reader.string(),'),
  ],
  noPacketCap: [edit(codec, 'length >= 1 && length <= remoteLimits.packetBytes,', 'length >= 1,')],
  noAttrFlags: [
    edit(codec, "protocolAssert((flags & 0x7ffffff0) === 0, 'Unknown SFTP attribute flags.');", ''),
  ],
  noAttrPairCap: [
    edit(
      codec,
      'if (reader.keepsExtendedAttribute()) extended.push(pair);',
      'extended.push(pair);',
    ),
  ],
  attrPairsFail: [
    edit(
      codec,
      'if (reader.keepsExtendedAttribute()) extended.push(pair);',
      "protocolAssert(reader.keepsExtendedAttribute(), 'Too many SFTP extended attributes.');\nextended.push(pair);",
    ),
  ],
  noExtensionCap: [
    edit(
      codec,
      "protocolAssert(extensions.size < sftpBounds.extensionPairs, 'Too many SFTP extensions.');",
      '',
    ),
  ],
  noExtensionDup: [
    edit(codec, "protocolAssert(!extensions.has(key), 'Duplicate SFTP extension.');", ''),
  ],
  noEmptyHandle: [
    edit(codec, "protocolAssert(reply.handle.length > 0, 'Empty SFTP handle.');", ''),
  ],
  nameDot: [
    edit(
      codec,
      "if (name === '.' || name === '..') return { kind: 'skip' };",
      "if (name === '..') return { kind: 'skip' };",
    ),
  ],
  nameDotDot: [
    edit(
      codec,
      "if (name === '.' || name === '..') return { kind: 'skip' };",
      "if (name === '.') return { kind: 'skip' };",
    ),
  ],
  nameSlash: [edit(codec, '!/[/\\0]/.test(name)', '!/[\\0]/.test(name)')],
  nameNul: [edit(codec, '!/[/\\0]/.test(name)', '!/[/]/.test(name)')],
  nameLength: [edit(codec, 'entry.filename.length <= remoteLimits.serverNameBytes', 'true')],
  nameFatal: [
    edit(
      codec,
      "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })",
      "new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })",
    ),
  ],
  nameBOM: [
    edit(
      codec,
      "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })",
      "new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })",
    ),
  ],
  writerCap: [
    edit(
      codec,
      "protocolAssert(length <= remoteLimits.packetBytes, 'Oversized SFTP packet.');",
      '',
    ),
  ],
  readLengthEncode: [
    edit(codec, 'request.length > 0 && request.length <= sftpBounds.dataBytes,', 'true,'),
  ],
  usersGroupsEnd: [edit(codec, '    list.end();\n', '')],
  noDuplicateHandle: [
    edit(
      client,
      "protocolAssert(generation === undefined || closing, 'Duplicate SFTP handle.');",
      '',
    ),
  ],
  noDataLength: [
    edit(client, 'reply.data.length <= entry.request.length && reply.data.length > 0,', 'true,'),
  ],
  noTypeCheck: [edit(client, "reply.kind === 'status' || reply.kind === entry.expected,", 'true,')],
  okStatusAnywhere: [
    edit(
      client,
      "protocolAssert(entry.expected === 'status', 'Unexpected successful SFTP status.');",
      '',
    ),
  ],
  credit65: [
    edit(
      client,
      'this.pending.size < remoteLimits.requestsPerChannel',
      'this.pending.size <= remoteLimits.requestsPerChannel',
    ),
  ],
  noIDSkip: [edit(client, 'while (this.pending.has(this.nextID))', 'while (false)')],
  idNoWrap: [
    edit(
      client,
      'this.nextID = (this.nextID + 1) >>> 0;\n    return id;',
      'this.nextID = this.nextID + 1;\n    return id;',
    ),
  ],
  timeoutKeepsChannel: [
    edit(
      client,
      /this\.fail\(\s*new SFTPError\('VIEWER_REMOTE_TIMEOUT', 'The server request timed out\.'\),?\s*\)/,
      "this.settle(entry, new SFTPError('VIEWER_REMOTE_TIMEOUT', 'The server request timed out.'))",
    ),
  ],
  anyVersion: [
    edit(
      client,
      "protocolAssert(reply.version === 3, 'The server did not negotiate SFTP version 3.');",
      '',
    ),
  ],
  secondVersion: [
    edit(client, "this.state === 'negotiating' && this.versionResolve !== undefined,", 'true,'),
  ],
  noOrphanFail: [
    edit(
      client,
      /this\.request\(\s*\{ kind: 'close', handle: reply\.handle \},\s*'status',\s*\{\},\s*false,\s*true,?\s*\)/,
      'Promise.resolve()',
    ),
  ],
  noHandleLimit: [edit(client, 'this.handles.size + this.openingHandles < handleLimit;', 'true;')],
  noQueueCap: [edit(client, 'this.metadataQueued() >= sftpBounds.queueRequests', 'false')],
  queueCapsStreams: [
    edit(
      client,
      /flow === this\.metadataFlow &&\s*this\.metadataQueued\(\) >= sftpBounds\.queueRequests/,
      'this.queue.length >= sftpBounds.queueRequests',
    ),
  ],
  queueCountsStreams: [edit(client, 'if (entry.flow === this.metadataFlow) count++;', 'count++;')],
  flowTurnsOff: [
    edit(client, 'const turn = this.turns.get(candidate.flow) ?? 0;', 'const turn = 0;'),
  ],
  orphanCloseQueueCapped: [
    edit(client, /!cleanup &&\s*flow === this\.metadataFlow/, 'flow === this.metadataFlow'),
  ],
  orphanCloseNotFirst: [edit(client, 'if (candidate.cleanup) return index;', '')],
  renameAnyLstatError: [
    edit(client, "if (!(error instanceof SFTPError) || error.code !== 'ENOENT') throw error;", ''),
  ],
  resolvedLength: [edit(client, 'result.length > remoteLimits.serverPathBytes ||', '')],
  copyNoPreCheck: [
    edit(client, /await coversRange\(\);\s*while \(copied < length\)/, 'while (copied < length)'),
  ],
  copyNoPostCheck: [
    edit(
      client,
      /\/\/ A source that shrank during the copy left the destination short\.\s*await coversRange\(\);/,
      '',
    ),
  ],
  copySizeUnknownAllowed: [
    edit(
      client,
      /if \(size === undefined\)\s*throw new SFTPError\('ENOTSUP', 'The server did not report the copy source size\.'\);/,
      'if (size === undefined) return;',
    ),
  ],
  noPacketLimit: [edit(client, 'bytes.length <= this.packetLimit,', 'true,')],
  noLinkGate: [
    edit(
      client,
      "if (![...this.extensionsValue.keys()].some((name) => name.endsWith('@openssh.com'))) {",
      'if (false) {',
    ),
  ],
  anyExtensionVersion: [
    edit(
      client,
      "return version?.equals(Buffer.from(extension === 'statvfs' ? '2' : '1')) ?? false;",
      'return version !== undefined;',
    ),
  ],
  noDrainWait: [edit(client, 'this.writable &&\n        this.queue.length', 'this.queue.length')],
  oneNameAny: [edit(client, 'if (names.length !== 1) {', 'if (names.length === 0) {')],
  abortedNoDrainTimer: [
    edit(client, '} else if (entry.timer === undefined) {', '} else if (false) {'),
  ],
  closeKeepsHandle: [
    edit(
      client,
      'if (this.handles.get(key) === entry.handleGeneration) this.handles.delete(key);',
      '',
    ),
  ],
  limitsIgnored: [
    edit(
      client,
      'this.limitsValue = this.decodeExtension(reply, decodeLimits);',
      'this.decodeExtension(reply, decodeLimits);',
    ),
  ],
  windowUnbounded: [readWindow],
  writeWindowUnbounded: [writeWindow],
  concurrencyUncapped: [concurrency],
  noRearm: [
    edit(
      streams,
      '    this.bytes += BigInt(bytes);\n    if (this.waiting > 0) this.arm();',
      '    this.bytes += BigInt(bytes);',
    ),
  ],
  shortReadIsBlock: [edit(streams, 'if (consumed === block.length) break;', 'break;')],
  stallKeepsChannel: [edit(streams, '      this.client.disconnect(error);\n', '')],
  noFinishAbort: [
    edit(
      streams,
      "    this.options.signal?.removeEventListener('abort', this.abort);\n    this.controller.abort();",
      "    this.options.signal?.removeEventListener('abort', this.abort);",
    ),
  ],
  stallSentNoArm: [
    edit(streams, 'if (this.waiting > 0 && this.timer === undefined) this.arm();', ''),
  ],
  stallWaitNoPause: [
    edit(
      streams,
      'if (server && --this.waiting === 0) this.pause();',
      'if (server) --this.waiting;',
    ),
  ],
  stallNoPauseOnZero: [
    edit(streams, /if \(this\.outstanding === 0\) \{\s*this\.pause\(\);\s*\}/, ''),
  ],
  stallSourceCounted: [
    edit(
      streams,
      'await lifetime.wait(Promise.resolve(iterator.next()), false);',
      'await lifetime.wait(Promise.resolve(iterator.next()), true);',
    ),
  ],
  noBufferCopy: [
    edit(
      streams,
      'const data = Buffer.from(item.value.subarray(index, index + chunk));',
      'const data = item.value.subarray(index, index + chunk);',
    ),
  ],
  bothWindowsOpen: [readWindow, writeWindow, concurrency],
  trailingRemove: [trailing],
  trailingRemoveNoAssert: [trailing, edit(fixture, 'server.assertSafePackets();', '')],
  deniedAsEACCES: [
    edit(errors, "? 'VIEWER_REMOTE_DENIED'", "? ('EACCES' as 'VIEWER_REMOTE_DENIED')"),
  ],
  lostNotOffline: [edit(errors, 'status === 6 || status === 7', 'status === 6')],
  sanitizeNoIgnorables: [edit(errors, '\\p{Zp}\\p{Default_Ignorable_Code_Point}]', '\\p{Zp}]')],
  sanitizeNoSeparators: [edit(errors, '\\p{Cf}\\p{Zl}\\p{Zp}', '\\p{Cf}')],
  sanitizeNoFormat: [edit(errors, '\\p{Cc}\\p{Cf}', '\\p{Cc}')],
  writerGuardOff: [
    edit(codec, /this\.length > 0 \|\| approvedPacketTypes\.includes\(value\)/, 'true'),
  ],
  unframedRemoveEncoder: [
    edit(
      codec,
      'export function decodeClientPacket(',
      'export function buildUnlink(id: number, file: Buffer): Buffer {\n  const body = new SFTPWriter().byte(6 + 7).uint32(id).string(file).build();\n  return Buffer.concat([Buffer.from([0, 0, 0, body.length]), body]);\n}\nexport function decodeClientPacket(',
    ),
  ],
  mkdirTimesAllowed: [
    edit(
      codec,
      /case 'mkdir':\s*writer\.string\(request\.path\);\s*writeCreateAttributes\(writer, request\.attrs\);/,
      "case 'mkdir':\nwriter.string(request.path);\nwriteSetAttributes(writer, request.attrs as never);",
    ),
  ],
  fakeDescriptiveMessages: [
    edit(
      fixture,
      'reply = this.status(decoded.id, error.status);',
      'reply = this.status(decoded.id, error.status, error.message);',
    ),
  ],
  fakeAutoGuardOff: [
    edit(
      fixture,
      /this\.transport\.destroy\(\);\s*this\.assertSafePackets\(\);/,
      'this.transport.destroy();',
    ),
    edit(fixture, 'server.assertSafePackets();', ''),
  ],
  fakeMkdirNoUmask: [edit(fixture, '& 0o7777 & ~0o022', '& 0o7777')],
  fakeFolderOntoLinkFailure: [
    edit(
      fixture,
      "throw new FakeStatus(2, 'Not a directory');",
      "throw new FakeStatus(4, 'Not a directory');",
    ),
  ],
  fakeIntoItselfFailure: [
    edit(
      fixture,
      "throw new FakeStatus(5, 'Invalid directory move');",
      "throw new FakeStatus(4, 'Invalid directory move');",
    ),
  ],
  fakeOverrideCloseKeepsSlot: [
    edit(
      fixture,
      /if \(this\.statusOverride && decoded\.request\.kind === 'close'\)\s*this\.handles\.delete\(decoded\.request\.handle\.toString\('hex'\)\);/,
      '',
    ),
  ],
  fakeDirectoryEOFText: [
    edit(fixture, 'return this.status(id, 1);', "return this.status(id, 1, 'End of directory');"),
  ],
};

const name = process.env.SFTP_MUTATION;
const active = name ? sftpMutations[name] : undefined;
if (name && !active) throw new Error('Unknown SFTP mutation: ' + name);
const mutation: Plugin = {
  name: 'sftp-review-regression-mutations',
  enforce: 'pre',
  transform(code, id) {
    const edits = active?.filter((candidate) => id.split('?')[0]!.endsWith(candidate.file));
    if (!edits?.length) return;
    let changed = code;
    for (const candidate of edits) {
      const next = changed.replace(candidate.before, candidate.after);
      if (next === changed) throw new Error('SFTP mutation no longer matches: ' + name);
      changed = next;
    }
    return changed;
  },
};

export default defineConfig({
  ...base,
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [...(base.plugins ?? []), mutation],
  test: {
    ...base.test,
    fsModuleCache: false,
    testTimeout: 3000,
    include: [
      'tests/remote-sftp-codec.test.ts',
      'tests/remote-sftp-client.test.ts',
      'tests/remote-sftp-streams.test.ts',
      'tests/remote-sftp-fake-server.test.ts',
      'tests/remote-sftp-policy.test.ts',
      'tests/remote-sftp-review.test.ts',
      'tests/remote-sftp-bounds.test.ts',
      'tests/remote-sftp-resolved.test.ts',
    ],
  },
});
