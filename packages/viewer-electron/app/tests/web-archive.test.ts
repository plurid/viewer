import { describe, expect, it } from 'vitest';
import { decodeBinaryPlist } from '../src/domain/previews/data/plist';
import { confirms, identifyBytes } from '../src/domain/files/signatures';
import {
  webArchiveLimits,
  webArchivePage,
  webArchiveSummary,
} from '../src/domain/previews/documents/web-archive';
import { binaryPlist } from '../tools/playground/samples/messages';

const encode = (text: string) => new TextEncoder().encode(text);
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
);
const page = `<!doctype html><html><head><title>Saved  page</title>
<base href="https://example.invalid/articles/">
<link rel="stylesheet" href="../css/site.css">
<script src="https://example.invalid/app.js"></script>
</head><body>
<img src="pic.png#frag" srcset="pic.png 1x, https://cdn.example.invalid/pic@2x.png 2x">
<img src="https://cdn.example.invalid/not-saved.png">
<iframe src="https://example.invalid/embed"></iframe>
<a href="https://example.invalid/next">Next</a>
</body></html>`;
const css = `@import "theme.css"; body { background: url("../img/back.png") } .x { background: url(https://cdn.example.invalid/x.png) }`;
const resource = (url: string, type: string, data: Uint8Array, encoding?: string) => ({
  WebResourceData: data,
  WebResourceMIMEType: type,
  WebResourceURL: url,
  ...(encoding ? { WebResourceTextEncodingName: encoding } : {}),
});
const archive = (main = page) =>
  binaryPlist({
    WebMainResource: resource(
      'https://example.invalid/articles/one.html',
      'text/html',
      encode(main),
      'UTF-8',
    ),
    WebSubresources: [
      resource('https://example.invalid/css/site.css', 'text/css', encode(css), 'UTF-8'),
      resource('https://example.invalid/css/theme.css', 'text/css', encode('h1 { color: teal }')),
      resource('https://example.invalid/img/back.png', 'image/png', png),
      resource('https://example.invalid/articles/pic.png', 'image/png', png),
      resource('https://example.invalid/app.js', 'application/javascript', encode('alert(1)')),
    ],
    WebSubframeArchives: [
      {
        WebMainResource: resource(
          'https://example.invalid/embed',
          'text/html',
          encode('<p>frame</p>'),
        ),
      },
    ],
  });

describe('Safari web archives', () => {
  it('decodes data as bytes when asked, and as a description otherwise', () => {
    const plist = binaryPlist({ data: png, text: 'Ștefan' });
    expect(decodeBinaryPlist(plist)).toEqual({
      data: `<data, ${png.length} bytes>`,
      text: 'Ștefan',
    });
    expect(decodeBinaryPlist(plist, { data: 'bytes' })).toEqual({ data: png, text: 'Ștefan' });
  });

  it('names a binary web archive by its bytes and confirms it for Show as', () => {
    const identity = identifyBytes(archive().subarray(0, 4096), 'saved');
    expect(identity).toEqual({ label: 'Safari web archive', extension: 'webarchive' });
    expect(confirms(identity, 'webarchive')).toBe(true);
    expect(identifyBytes(binaryPlist({ CFBundleName: 'Viewer' }), 'Info')).toEqual({
      label: 'Binary property list',
      extension: 'plist',
    });
  });

  it('summarizes the page’s address and title', () => {
    expect(webArchiveSummary(archive())).toMatchObject({
      url: 'https://example.invalid/articles/one.html',
      title: 'Saved page',
      resources: 5,
      frames: 1,
    });
  });

  it('serves the page with the subresources the archive holds, and nothing else', () => {
    const saved = webArchivePage(archive());
    const types = saved.parts.map((part) => [part.path, part.type]);
    expect(types).toEqual(
      expect.arrayContaining([
        ['parts/1.css', 'text/css'],
        ['parts/2.png', 'image/png'],
        ['parts/3.css', 'text/css'],
        ['parts/4.png', 'image/png'],
      ]),
    );
    expect(types.some(([, type]) => type === 'application/javascript')).toBe(false);
    expect(saved.html).toContain('<link rel="stylesheet" href="/parts/3.css">');
    expect(saved.html).toContain('<img src="/parts/4.png" srcset="/parts/4.png 1x">');
    expect(saved.html).not.toMatch(/<script|<iframe|<base/);
    expect(saved.html).not.toMatch(/src="https?:/);
    const stylesheet = new TextDecoder().decode(
      saved.parts.find((part) => part.path === 'parts/3.css')!.data,
    );
    expect(stylesheet).toBe(
      '@import "/parts/1.css"; body { background: url("/parts/2.png") } .x { background: url() }',
    );
    // the remote 2x picture, the unsaved image, the stylesheet's remote image and the frame
    expect(saved.blocked).toBe(4);
  });

  it('reads an XML web archive and a main resource that is not HTML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>WebMainResource</key><dict>
<key>WebResourceData</key><data>${Buffer.from('plain <text>').toString('base64')}</data>
<key>WebResourceMIMEType</key><string>text/plain</string>
<key>WebResourceURL</key><string>https://example.invalid/notes.txt</string>
</dict></dict></plist>`;
    const saved = webArchivePage(encode(xml));
    expect(saved.html).toContain('plain &lt;text&gt;');
    expect(saved.parts).toEqual([]);
  });

  it('refuses property lists that hold no page, malformed archives and oversized files', () => {
    expect(() => webArchivePage(binaryPlist({ WebSubresources: [] }))).toThrow('no saved web page');
    const broken = archive();
    broken.fill(0xff, broken.length - 20);
    expect(() => webArchivePage(broken)).toThrow();
    expect(() => webArchivePage(new Uint8Array(webArchiveLimits.bytes + 1))).toThrow('64 MB');
    expect(() => webArchivePage(encode('<html>not a plist</html>'))).toThrow();
  });
});
