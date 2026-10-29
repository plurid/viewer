import type { WebPreferences } from 'electron';
import { htmlCapability } from '../../domain/previews/html-address';

/** Every window and page Viewer opens: sandboxed, isolated from its preload, without Node. */
export const isolatedContent = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
} as const satisfies WebPreferences;

interface FrameLocation {
  readonly url: string;
  readonly parent: FrameLocation | null;
}

/** Frame getters can fail after Chromium detaches a frame. Never infer its old authority. */
export function frameLocationURLs(frame: FrameLocation | null | undefined): string[] {
  const urls: string[] = [];
  try {
    for (let depth = 0; frame && depth < 32; depth++, frame = frame.parent) urls.push(frame.url);
  } catch {
    return [];
  }
  return urls;
}

interface ContentAuthority {
  ownsHtmlURL(url: string): boolean;
  trustedDocument(url: string): boolean;
}

/** A preview can navigate within its own capability, never into the application or another page. */
export function frameNavigationAllowed(
  navigation: {
    url: string;
    mainFrame: boolean;
    frameURLs: readonly string[];
    initiatorURLs?: readonly string[];
  },
  authority: ContentAuthority,
): boolean {
  const privateSource = [...navigation.frameURLs, ...(navigation.initiatorURLs ?? [])].find((url) =>
    htmlCapability(url),
  );
  if (navigation.mainFrame) return !privateSource && authority.trustedDocument(navigation.url);

  const destination = htmlCapability(navigation.url);
  if (!destination || !authority.ownsHtmlURL(navigation.url)) return false;
  if (privateSource)
    return htmlCapability(privateSource) === destination && authority.ownsHtmlURL(privateSource);

  const [current = '', parent] = navigation.frameURLs;
  return (
    ['', 'about:blank', 'about:srcdoc'].includes(current) &&
    !!parent &&
    authority.trustedDocument(parent)
  );
}

/** Offline HTML frames cannot borrow the application's resource, network or development access. */
export function rendererRequestAllowed(
  request: {
    url: string;
    frameURLs: readonly string[];
    resourceType: string;
    initiatorOrigin?: string;
    referrer?: string;
  },
  authority: ContentAuthority & { development: boolean },
): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  const privateSource = [...request.frameURLs, request.referrer ?? ''].find((value) =>
    htmlCapability(value),
  );
  if (privateSource) {
    if (!authority.ownsHtmlURL(privateSource)) return false;
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
    return (
      htmlCapability(request.url) === htmlCapability(privateSource) &&
      authority.ownsHtmlURL(request.url)
    );
  }
  if (url.protocol === 'viewer-html:')
    return (
      request.resourceType === 'subFrame' &&
      !!htmlCapability(request.url) &&
      authority.ownsHtmlURL(request.url) &&
      request.frameURLs.some(authority.trustedDocument)
    );
  if (request.initiatorOrigin === 'null') return ['blob:', 'data:'].includes(url.protocol);
  return (
    ['viewer-app:', 'viewer-resource:', 'devtools:', 'blob:', 'data:'].includes(url.protocol) ||
    (authority.development &&
      ['http:', 'ws:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost'].includes(url.hostname))
  );
}
