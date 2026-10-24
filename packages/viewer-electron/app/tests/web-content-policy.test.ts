import { describe, expect, it } from 'vitest';
import {
  frameLocationURLs,
  frameNavigationAllowed,
  rendererRequestAllowed,
} from '../src/desktop/windows/web-content-policy';
import { htmlCapability } from '../src/domain/previews/html-address';

const application = 'viewer-app://app/index.html';
const page = 'viewer-html://11111111-1111-4111-8111-111111111111/index.html';
const other = 'viewer-html://22222222-2222-4222-8222-222222222222/index.html';
const authority = {
  trustedDocument: (url: string) => url.startsWith('viewer-app://app/'),
  ownsHtmlURL: (url: string) => htmlCapability(url) === htmlCapability(page),
  development: false,
};

describe('HTML frame navigation authority', () => {
  it('admits an owned capability only as an application child frame', () => {
    expect(
      frameNavigationAllowed(
        { url: page, mainFrame: false, frameURLs: ['about:blank', application] },
        authority,
      ),
    ).toBe(true);
    expect(
      frameNavigationAllowed(
        { url: other, mainFrame: false, frameURLs: ['about:blank', application] },
        authority,
      ),
    ).toBe(false);
    expect(
      frameNavigationAllowed({ url: page, mainFrame: true, frameURLs: [application] }, authority),
    ).toBe(false);
  });

  it('keeps page links in the same capability and rejects privileged or external navigation', () => {
    for (const destination of [application, other, 'https://example.com', 'file:///etc/passwd'])
      expect(
        frameNavigationAllowed(
          { url: destination, mainFrame: false, frameURLs: [page, application] },
          authority,
        ),
        destination,
      ).toBe(false);
    expect(
      frameNavigationAllowed(
        {
          url: page.replace('index.html', 'about.html'),
          mainFrame: false,
          frameURLs: [page, application],
        },
        authority,
      ),
    ).toBe(true);
    expect(
      frameNavigationAllowed(
        {
          url: application,
          mainFrame: true,
          frameURLs: [application],
          initiatorURLs: [page, application],
        },
        authority,
      ),
    ).toBe(false);
  });
});

describe('HTML request isolation', () => {
  const request = (url: string, frameURLs = [page, application]) =>
    rendererRequestAllowed({ url, frameURLs, resourceType: 'script' }, authority);

  it('allows local assets while denying other capabilities and Viewer resources', () => {
    expect(request(page.replace('index.html', 'script.js'))).toBe(true);
    for (const url of [
      other,
      application,
      'viewer-resource://33333333-3333-4333-8333-333333333333/asset/key.txt',
      'https://example.com/collect',
      'http://127.0.0.1:8080/',
      'file:///etc/passwd',
    ])
      expect(request(url), url).toBe(false);
  });

  it('keeps descendants and referrer-bearing requests inside the same page', () => {
    expect(request(application, ['about:blank', page, application])).toBe(false);
    expect(
      rendererRequestAllowed(
        { url: application, frameURLs: [], referrer: page, resourceType: 'script' },
        authority,
      ),
    ).toBe(false);
    expect(
      rendererRequestAllowed(
        {
          url: application,
          frameURLs: [],
          initiatorOrigin: 'null',
          resourceType: 'script',
        },
        authority,
      ),
    ).toBe(false);
  });

  it('does not let development network access widen HTML authority', () => {
    const local = 'http://localhost:5173/script.js';
    expect(
      rendererRequestAllowed(
        { url: local, frameURLs: [page, application], resourceType: 'script' },
        { ...authority, development: true },
      ),
    ).toBe(false);
    expect(
      rendererRequestAllowed(
        { url: local, frameURLs: [application], resourceType: 'script' },
        { ...authority, development: true },
      ),
    ).toBe(true);
    expect(
      rendererRequestAllowed(
        { url: local, frameURLs: [], initiatorOrigin: 'null', resourceType: 'script' },
        { ...authority, development: true },
      ),
    ).toBe(false);
  });

  it('does not admit credentials, ports or malformed capability hosts', () => {
    for (const url of [
      page.replace('viewer-html://', 'viewer-html://user@'),
      page.replace('/index.html', ':80/index.html'),
      'viewer-html://app/index.html',
      'not a URL',
    ])
      expect(htmlCapability(url), url).toBeUndefined();
  });

  it('treats detached frame metadata as unavailable', () => {
    expect(
      frameLocationURLs({
        get url(): string {
          throw new Error('Detached frame');
        },
        parent: null,
      }),
    ).toEqual([]);
  });
});
