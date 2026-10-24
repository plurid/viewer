import { describe, expect, it } from 'vitest';
import { applicationCSP } from '../src/desktop/windows/application-csp';

describe('application content security policy', () => {
  it('allows OCCT dynamic bindings only in its disposable CAD worker', () => {
    const policy = applicationCSP('/assets/cad.worker-CF_27-a.js');
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).not.toContain('viewer-resource:');
    expect(policy).not.toContain('http:');
  });

  it('keeps documents, other workers and path lookalikes unable to evaluate JavaScript', () => {
    for (const pathname of [
      '/index.html',
      '/settings.html',
      '/assets/index-abc.js',
      '/assets/pdf.worker-abc.js',
      '/assets/cad.worker-abc.js.map',
      '/assets/cad.worker-abc.js/other',
      '/other/cad.worker-abc.js',
      '/assets/cad.worker-.js',
      '/assets/cad.worker-abc.html',
      '/assets/%63ad.worker-abc.js',
      '/src/renderer/previews/model/cad.worker.ts',
    ]) {
      expect(applicationCSP(pathname), pathname).not.toContain("'unsafe-eval'");
    }
    expect(applicationCSP('/index.html')).not.toContain('http:');
    expect(applicationCSP('/index.html')).toContain('viewer-resource:');
  });

  it('supports the exact development worker without relaxing the development document', () => {
    const worker = '/src/renderer/previews/model/cad.worker.ts';
    expect(applicationCSP(worker, true)).toContain("'unsafe-eval'");
    expect(applicationCSP(worker + '.html', true)).not.toContain("'unsafe-eval'");
    expect(applicationCSP('/index.html', true)).not.toContain("'unsafe-eval'");
    expect(applicationCSP('/index.html', true)).toContain('ws://127.0.0.1:*');
    expect(applicationCSP(worker, true)).not.toContain('ws:');
  });

  it('frames private HTML without permitting inline application scripts or arbitrary frames', () => {
    const directives = applicationCSP('/index.html').split('; ');
    expect(directives.find((directive) => directive.startsWith('frame-src '))).toBe(
      'frame-src viewer-html:',
    );
    expect(directives.find((directive) => directive.startsWith('script-src '))).not.toContain(
      "'unsafe-inline'",
    );
  });
});
