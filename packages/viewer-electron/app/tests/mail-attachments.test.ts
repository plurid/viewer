/**
 * Saving an email's attachments: the name each is saved under, the part read from a message or a
 * mailbox's message, and the file operation that writes it, refuses a changed message and undoes.
 */
import type * as MacFilesModule from '../src/desktop/native/macos-files';
import type { OperationJob, OperationRequest } from '../src/domain/contracts';
import type { MailAttachmentPlan } from '../src/domain/previews/mail/attachments';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { savedAttachmentName } from '../src/domain/previews/mail/attachments';
import { messageAttachment, readMessage } from '../src/domain/previews/mail/message';
import { transformDescription, validateTransform } from '../src/domain/operations/transforms';
import type { SourceVersion } from '../src/domain/files/inspection';
import { sourceVersion } from '../src/domain/files/inspection';

/** Files marked as downloaded, in the order they were marked. */
const marked = vi.hoisted(() => [] as string[]);
// The packaged binding marks through Launch Services; here the mark is recorded.
vi.mock('../src/desktop/native/macos-files', async (original) => {
  const actual = await original<typeof MacFilesModule>();
  return {
    ...actual,
    macFiles: () =>
      Object.defineProperty(Object.create(actual.macFiles()), 'quarantineAttachment', {
        value: (file: string) => marked.push(file),
      }),
  };
});
import { Operations } from '../src/desktop/operations/operations';
import { Transforms } from '../src/desktop/transforms/transforms';
import { entry } from '../src/desktop/files/filesystem';

interface Attachment {
  name: string;
  type: string;
  data: Buffer;
  encoding: 'base64' | 'quoted-printable';
}
const encoded = ({ data, encoding }: Attachment) =>
  encoding === 'base64'
    ? (data.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
    : data.toString('latin1').replace(/=/g, '=3D');
/** A multipart message: a plain body, then each attachment. */
function message(subject: string, attachments: Attachment[]): string {
  return [
    'From: Ana Ionescu <ana@example.invalid>',
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="part"',
    '',
    '--part',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The files are attached.',
    ...attachments.flatMap((attachment) => [
      '--part',
      `Content-Type: ${attachment.type}; name="${attachment.name}"`,
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      `Content-Transfer-Encoding: ${attachment.encoding}`,
      '',
      encoded(attachment),
    ]),
    '--part--',
    '',
  ].join('\r\n');
}
const packing: Attachment = {
  name: 'Packing list.txt',
  type: 'text/plain',
  data: Buffer.from('Boots\nTent\nMap = 1:25000\n'),
  encoding: 'quoted-printable',
};
const picture: Attachment = {
  name: 'Ridge.png',
  type: 'image/png',
  data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128, 7]),
  encoding: 'base64',
};
const trip = message('Field trip', [packing, picture]);

describe('the name an attachment is saved under', () => {
  it.each([
    ['Invoice 2026.pdf', 'Invoice 2026.pdf'],
    ['Q1/Q2\\Q3:Q4.csv', 'Q1-Q2-Q3-Q4.csv'],
    ['../../.ssh/authorized_keys', '-..-.ssh-authorized_keys'],
    ['..hidden.sh', 'hidden.sh'],
    [' .profile ', 'profile'],
    ['notes.txt. . ', 'notes.txt'],
    ['invoice\u202efdp.exe', 'invoicefdp.exe'],
    ['re\u2066port\u2069\u200f.pdf', 'report.pdf'],
    ['bell\u0007\u0000\u009b.txt', 'bell.txt'],
    ['CON.txt', 'CON_.txt'],
    ['aux.tar.gz', 'aux_.tar.gz'],
    ['lpt1', 'lpt1_'],
    ['console.txt', 'console.txt'],
    ['', 'Attachment'],
    ['. . .', 'Attachment'],
    ['Cafe\u0301.txt', 'Caf\u00e9.txt'],
  ])('saves %j as %j', (name, saved) => {
    expect(savedAttachmentName(name)).toBe(saved);
    expect(savedAttachmentName(saved)).toBe(saved);
  });

  it('shortens a long name between whole characters and keeps its extension', () => {
    const bytes = (name: string) => new TextEncoder().encode(name).length;
    const accented = savedAttachmentName('é'.repeat(300) + '.pdf');
    expect(bytes(accented)).toBeLessThanOrEqual(240);
    expect(accented).toBe('é'.repeat(118) + '.pdf');
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    const families = savedAttachmentName(family.repeat(40) + '.png');
    expect(bytes(families)).toBeLessThanOrEqual(240);
    expect(
      families
        .slice(0, -'.png'.length)
        .split(family)
        .every((rest) => rest === ''),
    ).toBe(true);
    expect(families.endsWith('.png')).toBe(true);
    expect(savedAttachmentName(families)).toBe(families);
    // an extension longer than any real one is not kept whole
    const long = savedAttachmentName('a'.repeat(200) + '.' + 'b'.repeat(100));
    expect(bytes(long)).toBe(240);
    expect(savedAttachmentName('x'.repeat(260), 'Attachment 3')).toHaveLength(240);
  });
});

describe('an attachment read from its message', () => {
  it('is the part the preview lists there, decoded from its transfer encoding', () => {
    const bytes = new TextEncoder().encode(trip);
    const listed = readMessage(bytes).attachments;
    for (const [part, expected] of [packing, picture].entries()) {
      const found = messageAttachment(bytes, part)!;
      expect(found.data).toEqual(new Uint8Array(expected.data));
      expect({ name: found.name, type: found.type, size: found.size }).toEqual(listed[part]);
    }
    expect(messageAttachment(bytes, 2)).toBeUndefined();
  });

  it('is saved by a plan that names one message and one part', () => {
    const plan = validateTransform({ kind: 'mail-attachment', message: 3, part: 1 }, 1);
    expect(transformDescription(plan)).toBe(
      'Save attachment · message 4 · attachment 2 · marked as downloaded',
    );
    expect(() => validateTransform({ kind: 'mail-attachment', part: 0 }, 2)).toThrow(
      'one message at a time',
    );
    expect(() => validateTransform({ kind: 'mail-attachment', part: 500 }, 1)).toThrow();
  });
});

describe('saving an attachment as a file operation', () => {
  let root: string, trash: string, operations: Operations;
  beforeEach(async () => {
    marked.length = 0;
    root = await temporaryRoot('viewer-mail-attachments-');
    trash = path.join(root, 'Trash');
    await mkdir(trash);
    const transforms = new Transforms(
      root,
      async () => {},
      async () => {
        throw new Error('No image is encoded here.');
      },
    );
    operations = new Operations(
      async (file) => rename(file, path.join(trash, crypto.randomUUID())),
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      transforms,
    );
  });
  afterEach(async () => {
    await operations.close();
    await trashTemporary(root);
  });

  async function settled(id: string): Promise<OperationJob> {
    await vi.waitFor(
      () => {
        const job = operations.all().find((item) => item.id === id)!;
        expect(['completed', 'failed', 'cancelled']).toContain(job.status);
      },
      { timeout: 10000, interval: 10 },
    );
    return operations.all().find((item) => item.id === id)!;
  }
  /** Saves as the preview does: the name it lists, with the message's version as it was read. */
  async function save(
    file: string,
    plan: Omit<MailAttachmentPlan, 'kind'>,
    name: string,
    destination = path.dirname(file),
    read?: SourceVersion,
  ): Promise<OperationJob> {
    const version = read ?? sourceVersion(await entry(file));
    const request: OperationRequest = {
      kind: 'convert',
      sources: [file],
      destination,
      name: savedAttachmentName(name),
      transform: validateTransform({ kind: 'mail-attachment', ...plan }, 1),
      expectedSources: [{ path: file, version }],
    };
    return settled(operations.start(request));
  }

  it('saves beside the message under a free name, marked as downloaded and not executable', async () => {
    const file = path.join(root, 'Trip.eml');
    await writeFile(file, trip);
    const first = await save(file, { part: 0 }, packing.name);
    expect(first).toMatchObject({ status: 'completed', undoable: true });
    const saved = path.join(root, 'Packing list.txt');
    expect(first.completed).toEqual([{ source: file, destination: saved }]);
    expect(await readFile(saved)).toEqual(packing.data);
    expect((await lstat(saved)).mode & 0o111).toBe(0);
    // marked in its stage, before it took its name
    expect(marked).toHaveLength(1);
    expect(path.dirname(marked[0]!)).not.toBe(root);
    const again = await save(file, { part: 0 }, packing.name);
    expect(again.completed).toEqual([
      { source: file, destination: path.join(root, 'Packing list copy.txt') },
    ]);
    expect(await readFile(file, 'utf8')).toBe(trip);
  });

  it('saves to a chosen folder, decoding a picture', async () => {
    const file = path.join(root, 'Trip.eml');
    const chosen = path.join(root, 'Chosen');
    await writeFile(file, trip);
    await mkdir(chosen);
    const job = await save(file, { part: 1 }, picture.name, chosen);
    expect(job.status).toBe('completed');
    expect(await readFile(path.join(chosen, 'Ridge.png'))).toEqual(picture.data);
  });

  it("saves an attachment of a mailbox's message, read by its place in the mailbox", async () => {
    const file = path.join(root, 'Archive.mbox');
    const later = {
      ...packing,
      name: 'Route.txt',
      data: Buffer.from('North ridge, then the lake'),
    };
    await writeFile(
      file,
      [
        'From ana@example.invalid Mon Mar  2 09:12:00 2026',
        message('First', [packing]),
        'From ana@example.invalid Fri Mar  6 18:42:00 2026',
        message('Second', [picture, later]),
      ].join('\n'),
    );
    const job = await save(file, { message: 1, part: 1 }, later.name);
    expect(job.status).toBe('completed');
    expect(await readFile(path.join(root, 'Route.txt'))).toEqual(later.data);
    const missing = await save(file, { message: 1, part: 2 }, 'Gone.txt');
    expect(missing.status).toBe('failed');
    expect(missing.errors.at(-1)?.message).toBe('This attachment is no longer in the message.');
  });

  it('refuses once the message changed after it was read, and writes nothing', async () => {
    const file = path.join(root, 'Trip.eml');
    await writeFile(file, trip);
    const read = sourceVersion(await entry(file));
    await writeFile(file, message('Field trip', [picture, packing]));
    const job = await save(file, { part: 0 }, packing.name, root, read);
    expect(job.status).toBe('failed');
    expect(job.errors.at(-1)?.message).toBe('The source changed after review. Prepare a new plan.');
    expect((await readdir(root)).sort()).toEqual(['Trash', 'Trip.eml']);
    expect(marked).toEqual([]);
  });

  it('refuses a name the attachment is not saved under', async () => {
    const file = path.join(root, 'Trip.eml');
    await writeFile(file, trip);
    const job = await settled(
      operations.start({
        kind: 'convert',
        sources: [file],
        destination: root,
        name: '.hidden.txt',
        transform: validateTransform({ kind: 'mail-attachment', part: 0 }, 1),
      }),
    );
    expect(job.status).toBe('failed');
    expect(job.errors.at(-1)?.message).toContain('without hidden or control characters');
  });

  it('undoes a save by moving the saved file to the Trash', async () => {
    const file = path.join(root, 'Trip.eml');
    await writeFile(file, trip);
    const job = await save(file, { part: 1 }, picture.name);
    const saved = path.join(root, 'Ridge.png');
    expect(job.undoable).toBe(true);
    await operations.undo(job.id);
    await expect(lstat(saved)).rejects.toMatchObject({ code: 'ENOENT' });
    const trashed = await readdir(trash);
    expect(trashed).toHaveLength(1);
    expect(await readFile(path.join(trash, trashed[0]!))).toEqual(picture.data);
    expect(await readFile(file, 'utf8')).toBe(trip);
  });
});
