/**
 * A BROWSER PLANE'S IDENTITY: pages see Chromium's own user agent, without Viewer's and Electron's
 * tokens, which some sites refuse ("WhatsApp works with Google Chrome 100+").
 */
import { describe, expect, it } from 'vitest';
import { chromeUserAgent } from '../src/domain/previews/browser';

const electron =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Viewer/1.0.0 Chrome/142.0.7444.52 Electron/45.1.0 Safari/537.36';

describe('a browser plane’s user agent', () => {
  it('is Chromium’s own, without the app’s and Electron’s tokens', () => {
    expect(chromeUserAgent(electron, 'Viewer')).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.52 Safari/537.36',
    );
  });
  it('reads the app’s name as text, in any case', () => {
    expect(chromeUserAgent(electron.replace('Viewer/', 'viewer/'), 'Viewer')).not.toMatch(
      /viewer\//i,
    );
    expect(chromeUserAgent('Mozilla/5.0 A.B/1 Chrome/1', 'A.B')).toBe('Mozilla/5.0 Chrome/1');
    expect(chromeUserAgent('Mozilla/5.0 AxB/1 Chrome/1', 'A.B')).toBe('Mozilla/5.0 AxB/1 Chrome/1');
  });
  it('leaves an agent without those tokens as it is', () => {
    const chrome = electron.replace(' Viewer/1.0.0', '').replace(' Electron/45.1.0', '');
    expect(chromeUserAgent(chrome, 'Viewer')).toBe(chrome);
  });
});
