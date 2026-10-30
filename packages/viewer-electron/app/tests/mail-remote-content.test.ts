// @vitest-environment jsdom
/**
 * Remote content in an HTML email is not loaded: the page Viewer serves names no outside address
 * an element would load, as a browser's own parser reads it, and its policy allows none.
 */
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { readSavedPage } from '../src/desktop/previews/saved-pages';
import { WebPreviews } from '../src/desktop/previews/web/service';

const services: WebPreviews[] = [];
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()));
});

const tracker = 'track.example.invalid';
const html = `<!doctype html><html><head>
<meta http-equiv="refresh" content="1; url=https://${tracker}/refresh">
<base href="https://${tracker}/">
<link rel="stylesheet" href="https://${tracker}/style.css"><link rel="preload" href="https://${tracker}/font.woff2">
<link rel=icon href=//${tracker}/favicon.ico>
<style>@import 'https://${tracker}/import.css'; body { background: url(https://${tracker}/body.png) }
@font-face { font-family: x; src: url(https://${tracker}/font.woff) }</style>
<script>new Image().src = 'https://${tracker}/script.gif'</script>
</head><body background="https://${tracker}/background.png">
<p>Hello <img src="https://${tracker}/open.gif?id=1" width="1" height="1" alt=""></p>
<img src="relative/pixel.gif"><img srcset="https://${tracker}/1x.png 1x,https://${tracker}/2x.png 2x">
<picture><source srcset="https://${tracker}/source.webp"><img src="cid:map@viewer"></picture>
<table><tr><td background="https://${tracker}/cell.png" style="background:url(&quot;https://${tracker}/inline.png&quot;)">cell</td></tr></table>
<video src="https://${tracker}/video.mp4" poster="https://${tracker}/poster.jpg"></video><audio src="https://${tracker}/a.mp3"></audio>
<svg><image href="https://${tracker}/svg.png"/><image xlink:href="https://${tracker}/svg2.png"/></svg>
<iframe src="https://${tracker}/frame"></iframe><embed src="https://${tracker}/embed"><object data="https://${tracker}/object"></object>
<!-- comment --!><img src="https://${tracker}/after-comment.gif">
<a href="https://shop.example.invalid/" ping="https://${tracker}/ping">Shop</a>
<form action="https://${tracker}/form"><input type="image" src="https://${tracker}/submit.png"></form>
</body></html>`;
const message = `From: News <news@example.invalid>
To: you@example.invalid
Subject: Remote content
MIME-Version: 1.0
Content-Type: multipart/related; boundary="r"

--r
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: quoted-printable

${html.replace(/=/g, '=3D')}
--r
Content-Type: image/png
Content-ID: <map@viewer>
Content-Transfer-Encoding: base64

iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=
--r--
`.replace(/\n/g, '\r\n');

/** Every address the parsed page would load, by the elements and styles that load them. */
function loaded(document: Document): string[] {
  const urls: string[] = [];
  const css = (text: string) => {
    for (const match of text.matchAll(/url\(\s*["']?([^"')]*)/g)) urls.push(match[1]!);
    for (const match of text.matchAll(/@import\s+["']([^"']*)/g)) urls.push(match[1]!);
  };
  for (const element of document.querySelectorAll('*')) {
    for (const name of [
      'src',
      'href',
      'xlink:href',
      'background',
      'poster',
      'data',
      'action',
      'ping',
    ])
      if (element.hasAttribute(name) && !(element.localName === 'a' && name === 'href'))
        urls.push(element.getAttribute(name)!);
    for (const name of ['srcset'])
      for (const candidate of element.getAttribute(name)?.split(',') ?? [])
        urls.push(candidate.trim().split(/\s+/)[0]!);
    css(element.getAttribute('style') ?? '');
    if (element.localName === 'style') css(element.textContent ?? '');
    if (element.localName === 'meta' && element.getAttribute('http-equiv')) urls.push('meta');
    if (element.localName === 'base' || element.localName === 'script')
      urls.push(element.localName);
  }
  return urls.filter(Boolean);
}

it('serves an HTML email that loads nothing from outside the message', async () => {
  const folder = await realpath(await temporaryRoot('viewer-mail-remote-'));
  const file = path.join(folder, 'Remote content.eml');
  await writeFile(file, message);
  const service = new WebPreviews(async () => {});
  services.push(service);
  const preview = await service.openPage(1, file, 'resource', (signal) =>
    readSavedPage(file, 'eml', undefined, signal),
  );
  // the line the view shows: Remote images are blocked.
  expect(preview.blocked).toBeGreaterThanOrEqual(20);
  const response = await service.response(new Request(preview.url));
  const csp = response.headers.get('content-security-policy')!;
  expect(csp.split('; ')).toEqual(
    expect.arrayContaining([
      'sandbox',
      "default-src 'none'",
      `img-src viewer-html://${preview.id} data:`,
      `style-src viewer-html://${preview.id} 'unsafe-inline'`,
      `font-src viewer-html://${preview.id} data:`,
    ]),
  );
  const document = new DOMParser().parseFromString(await response.text(), 'text/html');
  const addresses = loaded(document).map((value) => new URL(value, preview.url));
  expect(addresses.map((url) => url.href)).toEqual([`viewer-html://${preview.id}/parts/1.png`]);
  // links keep their address as a title, and go nowhere
  const link = document.querySelector('a')!;
  expect(link.hasAttribute('href')).toBe(false);
  expect(link.getAttribute('title')).toBe('https://shop.example.invalid/');
  const picture = await service.response(new Request(addresses[0]!.href));
  expect(picture.headers.get('content-type')).toBe('image/png');
});
