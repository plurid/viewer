import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { messageSamples } from '../tools/playground/samples/messages';
import { extractDocument } from '../src/desktop/previews/formats';
import { DocumentCache } from '../src/desktop/previews/document-cache';
import { readSavedPage } from '../src/desktop/previews/saved-pages';
import { WebPreviews } from '../src/desktop/previews/web/service';
import { rendererRequestAllowed } from '../src/desktop/windows/web-content-policy';
import { htmlCapability } from '../src/domain/previews/html-address';
import { savedPageLimits } from '../src/domain/previews/saved-page';

const image = readFile(
  path.join(import.meta.dirname, '../tools/playground/assets/study-small.png'),
);
const services: WebPreviews[] = [];
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()));
});

/** The playground's email, mailbox, book and web archive, written to a new folder. */
async function samples() {
  const folder = await realpath(await temporaryRoot('viewer-saved-pages-'));
  const files: Record<string, string> = {};
  for (const sample of messageSamples(new Uint8Array(await image))) {
    const file = path.join(folder, path.basename(sample.path));
    await writeFile(file, sample.bytes);
    files[path.extname(file).slice(1)] = file;
  }
  return { folder, files };
}

describe('reading email, books and saved pages in the preview worker', () => {
  it('reads a message, Apple Mail’s form of it, and lists a mailbox', async () => {
    const { files } = await samples();
    for (const format of ['eml', 'emlx']) {
      const document = await extractDocument(files[format]!);
      expect(document.mail).toMatchObject({
        subject: 'Field trip: Saturday at the lighthouse ⛵',
        cc: 'Ștefan Popa <stefan@example.invalid>',
        html: true,
        attachments: [{ name: 'Packing list.txt', type: 'text/plain', size: 52 }],
      });
      expect(document.text).toContain('north gate');
    }
    const mailbox = await extractDocument(files.mbox!);
    expect(mailbox.mail).toBeUndefined();
    expect(mailbox.mailbox?.messages.map((row) => row.subject)).toEqual([
      'Lighthouse survey dates',
      'Re: Lighthouse survey dates ✔',
      'Gear list',
      'Field trip: final plan',
    ]);
    const third = await extractDocument(files.mbox!, { message: 2 });
    expect(third.mail).toMatchObject({ subject: 'Gear list', html: true });
    const last = await extractDocument(files.mbox!, { message: 3 });
    expect(last.mail?.text).toBe('We meet at 08:30. Coffee at the café after.');
    await expect(extractDocument(files.mbox!, { message: 9 })).rejects.toThrow(
      'no longer in the mailbox',
    );
  });

  it('caches a mailbox list apart from each of its messages', async () => {
    const { files } = await samples();
    const cache = new DocumentCache();
    const list = await cache.read(files.mbox!);
    const message = await cache.read(files.mbox!, undefined, undefined, undefined, 'mbox', 1);
    expect(list.mailbox?.messages).toHaveLength(4);
    expect(message.mail?.subject).toBe('Re: Lighthouse survey dates ✔');
    expect(await cache.read(files.mbox!)).toBe(list);
  });

  it('reads a mailbox that grew since it was listed from its new bytes', async () => {
    const { folder } = await samples();
    const file = path.join(folder, 'Growing.mbox');
    const first = 'From a@example.invalid Mon Mar  2 09:12:00 2026\nSubject: One\n\nfirst\n';
    await writeFile(file, first);
    expect((await extractDocument(file)).mailbox?.messages).toHaveLength(1);
    await writeFile(
      file,
      first + '\nFrom b@example.invalid Mon Mar  2 09:13:00 2026\nSubject: Two\n\nsecond\n',
    );
    expect((await extractDocument(file, { message: 1 })).mail?.subject).toBe('Two');
  });

  it('reads a FictionBook into reader chapters with its cover as a checked data URL', async () => {
    const { files } = await samples();
    const document = await extractDocument(files.fb2!);
    expect(document.metadata).toMatchObject({
      title: 'Lighthouse Notes',
      creator: 'Ana Ionescu; Mara Lin',
    });
    expect(document.chapters?.map((chapter) => chapter.title)).toEqual([
      'Lighthouse Notes',
      'Morning',
      'Evening',
      'Notes',
    ]);
    expect(document.epub?.images).toEqual([
      {
        path: 'images/1.png',
        size: (await image).length,
        data: `data:image/png;base64,${(await image).toString('base64')}`,
      },
    ]);
    expect(document.evidence.find((item) => item.source === 'chapter:Morning')?.anchor).toEqual({
      kind: 'epub',
      chapter: 1,
    });
  });

  it('summarizes a web archive and builds the pages each format shows', async () => {
    const { files } = await samples();
    const document = await extractDocument(files.webarchive!);
    expect(document.webArchive).toEqual({
      url: 'https://field-notes.example.invalid/trip/',
      title: 'Field notes: the lighthouse trip',
      resources: 2,
      frames: 0,
    });
    const archived = await readSavedPage(files.webarchive!, 'webarchive', undefined);
    expect(archived.parts.map((part) => part.type).sort()).toEqual(['image/png', 'text/css']);
    expect(archived.blocked).toBe(1);
    const mail = await readSavedPage(files.eml!, 'eml', undefined);
    expect(mail.parts).toEqual([
      { path: 'parts/1.png', type: 'image/png', data: new Uint8Array(await image) },
    ]);
    expect(mail.blocked).toBe(1);
    const message = await readSavedPage(files.mbox!, 'mbox', 2);
    expect(message.html).toContain('<em>two</em> lenses');
    await expect(readSavedPage(files.mbox!, 'mbox', undefined)).rejects.toThrow('Choose a message');
    await expect(readSavedPage(files.fb2!, 'fb2', undefined)).rejects.toThrow('no saved page');
  });

  it('refuses files past their read limits without reading them whole', async () => {
    const { folder } = await samples();
    const file = path.join(folder, 'Huge.eml');
    await writeFile(file, '');
    const handle = await (await import('node:fs/promises')).open(file, 'r+');
    await handle.truncate(64 * 1024 * 1024 + 1);
    await handle.close();
    await expect(extractDocument(file)).rejects.toThrow('extraction limit');
  });
});

describe('a saved page served by the private HTML protocol', () => {
  const access = vi.fn(async (_files: readonly string[]) => {});
  const page = {
    html: '<!doctype html><img src="parts/1.png"><link rel="stylesheet" href="parts/2.css">',
    parts: [
      { path: 'parts/1.png', type: 'image/png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) },
      { path: 'parts/2.css', type: 'text/css', data: new TextEncoder().encode('p{color:red}') },
    ],
    blocked: 3,
  };
  const open = async (service = new WebPreviews(access)) => {
    services.push(service);
    const preview = await service.openPage(
      1,
      '/fixtures/mail/Trip.eml',
      'resource',
      async () => page,
    );
    return { service, preview };
  };

  it('serves the page and its parts with no scripts, no network and a token-free sandbox', async () => {
    const { service, preview } = await open();
    expect(preview.blocked).toBe(3);
    expect(htmlCapability(preview.url)).toBe(preview.id);
    expect(service.ownsHtmlURL(1, preview.url)).toBe(true);
    expect(service.ownsHtmlURL(2, preview.url)).toBe(false);
    const response = await service.response(new Request(preview.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(page.html);
    const csp = response.headers.get('content-security-policy')!;
    const directives = csp.split('; ');
    expect(directives[0]).toBe('sandbox');
    expect(csp).not.toContain('allow-scripts');
    expect(csp).not.toContain('script-src');
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain(`img-src viewer-html://${preview.id} data:`);
    expect(directives).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https?:\/\/(?!127\.0\.0\.1:\*|localhost:\*)/);
    expect(response.headers.get('x-dns-prefetch-control')).toBe('off');
    const picture = await service.response(new Request(new URL('parts/1.png', preview.url)));
    expect(picture.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(page.parts[0]!.data);
    const style = await service.response(
      new Request(new URL('/parts/2.css', preview.url), { headers: { Origin: 'null' } }),
    );
    expect(style.headers.get('content-type')).toBe('text/css; charset=utf-8');
    const head = await service.response(new Request(preview.url, { method: 'HEAD' }));
    expect(head.headers.get('content-length')).toBe(String(page.html.length));
    expect(await head.text()).toBe('');
    for (const [request, status] of [
      [new Request(new URL('parts/9.png', preview.url)), 404],
      [new Request(new URL('../../etc/passwd', preview.url)), 404],
      [new Request(new URL('.hidden', preview.url)), 403],
      [new Request(preview.url, { method: 'POST', body: 'x' }), 405],
      [new Request(preview.url, { headers: { Origin: 'https://example.invalid' } }), 403],
    ] as const)
      expect((await service.response(request)).status).toBe(status);
    // the page reads no file after it was made
    expect(access).not.toHaveBeenCalled();
  });

  it('closes with its resource, its window, or a change to its folder', async () => {
    const { service, preview } = await open();
    await service.releaseResource('resource');
    expect((await service.response(new Request(preview.url))).status).toBe(404);
    const second = await open(service);
    await service.quiesce('/fixtures/mail');
    expect((await service.response(new Request(second.preview.url))).status).toBe(404);
    const third = await open(service);
    await service.stopOwner(1);
    expect((await service.response(new Request(third.preview.url))).status).toBe(404);
  });

  it('bounds the page, and the memory every page holds together', async () => {
    const service = new WebPreviews(access);
    services.push(service);
    const oversized = {
      html: 'x'.repeat(savedPageLimits.htmlBytes + 1),
      parts: [],
      blocked: 0,
    };
    await expect(
      service.openPage(1, '/fixtures/a.eml', 'one', async () => oversized),
    ).rejects.toThrow('4 MB');
    const large = {
      html: '<p>large</p>',
      parts: [{ path: 'parts/1.png', type: 'image/png', data: new Uint8Array(30 * 1024 * 1024) }],
      blocked: 0,
    };
    for (let index = 0; index < 4; index++)
      await service.openPage(1, '/fixtures/a.eml', `large-${index}`, async () => large);
    await expect(
      service.openPage(1, '/fixtures/a.eml', 'large-5', async () => large),
    ).rejects.toThrow('Close a preview');
  });

  it('lets the page frame load only its own capability', () => {
    const url = 'viewer-html://11111111-1111-4111-8111-111111111111/page.html';
    const authority = {
      trustedDocument: (value: string) => value.startsWith('viewer-app://app/'),
      ownsHtmlURL: (value: string) => htmlCapability(value) === htmlCapability(url),
      development: false,
    };
    const from = (target: string, resourceType = 'image') =>
      rendererRequestAllowed(
        { url: target, frameURLs: [url, 'viewer-app://app/index.html'], resourceType },
        authority,
      );
    expect(from(url.replace('page.html', 'parts/1.png'))).toBe(true);
    for (const target of [
      'https://track.example.invalid/pixel.gif',
      'http://127.0.0.1:8080/x.png',
      'viewer-resource://resource/file.png',
      'viewer-html://22222222-2222-4222-8222-222222222222/page.html',
      'file:///etc/passwd',
    ])
      expect(from(target), target).toBe(false);
  });
});
