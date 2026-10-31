import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FabricationAnswer } from '../src/domain/fabrication/answer';
import {
  configuredEvaluationProvider,
  inspectEvaluationProviders,
  readEvaluationProviders,
} from '../src/desktop/fabrication/evaluation';
import { Credentials, providerBinding } from '../src/desktop/models/providers';
import { evaluateLive } from '../tools/fabrication/evaluate-live';
import { profileEvaluationOptions } from '../tools/fabrication/profile-options';
import { temporaryRoot } from '../tools/temporary';
import { meta } from './fabrication-fixtures';

describe('configured fabrication evaluation', () => {
  it('inspects metadata without decryption, network or changing the profile', async () => {
    const profile = await temporaryRoot('viewer-evaluation-profile-');
    const text = `// The existing Viewer profile\n${JSON.stringify({ settings: { providers: [meta] } })}`;
    await writeFile(path.join(profile, 'config.jsonc'), text);
    const decrypt = vi.fn(async () => 'not-read');
    const credentials = new Credentials(profile, async () => Buffer.from('encrypted'), decrypt);
    await credentials.set(meta.id, 'an-api-key', providerBinding(meta));
    const before = await readdir(profile);
    const providers = await readEvaluationProviders(profile);
    expect(await inspectEvaluationProviders(providers, credentials)).toEqual([
      { id: meta.id, name: meta.name, kind: 'meta', model: meta.model, keyPresent: true },
    ]);
    expect(decrypt).not.toHaveBeenCalled();
    expect(await readFile(path.join(profile, 'config.jsonc'), 'utf8')).toBe(text);
    expect(await readdir(profile)).toEqual(before);
  });

  it('refuses malformed configuration without exposing its contents', async () => {
    const profile = await temporaryRoot('viewer-evaluation-invalid-');
    await writeFile(path.join(profile, 'config.jsonc'), '{"private":"sensitive-value",');
    await expect(readEvaluationProviders(profile)).rejects.toThrow(
      'Viewer has no valid model configuration.',
    );
  });

  it('requires a configured Meta provider and an explicit choice when several exist', async () => {
    const credentials = { forProvider: vi.fn(async () => 'captured-key') };
    await expect(configuredEvaluationProvider([], credentials)).rejects.toThrow('Configure a Meta');
    await expect(
      configuredEvaluationProvider([meta, { ...meta, id: 'second' }], credentials),
    ).rejects.toThrow('Several Meta providers');
    await expect(
      configuredEvaluationProvider([{ ...meta, endpoint: 'https://other.example' }], credentials),
    ).rejects.toThrow('unsupported endpoint');
    expect(credentials.forProvider).not.toHaveBeenCalled();
  });

  it('retains the existing endpoint binding and refuses legacy rebinding', async () => {
    const profile = await temporaryRoot('viewer-evaluation-key-binding-');
    const decrypt = vi.fn(async () => 'captured-secret');
    const credentials = new Credentials(profile, async () => Buffer.from('encrypted'), decrypt);
    await credentials.set(
      meta.id,
      'secret',
      providerBinding({ kind: 'meta', endpoint: 'https://other.example' }),
    );
    await expect(configuredEvaluationProvider([meta], credentials)).rejects.toThrow(
      'type or endpoint changed',
    );
    expect(decrypt).not.toHaveBeenCalled();
    await credentials.set(meta.id, 'secret');
    await expect(configuredEvaluationProvider([meta], credentials)).rejects.toThrow(
      'before keys were tied',
    );
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('uses the configured provider in the real check service while redacting an echoed key', async () => {
    const secret = 'offline-configured-secret-123456789';
    const configured = {
      ...meta,
      id: 'local-meta',
      model: 'configured-model',
      effort: 'minimal' as const,
    };
    const credentials = { forProvider: vi.fn(async () => secret) };
    const authentication = await configuredEvaluationProvider([configured], credentials);
    const logs: string[] = [];
    const request = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + secret);
      const body = JSON.parse(String(init?.body)) as { model: string; reasoning_effort: string };
      expect(body.model).toBe('configured-model');
      expect(body.reasoning_effort).toBe('minimal');
      const answer: FabricationAnswer = {
        summary: `Echoed ${secret}`,
        request: [],
        findings: [],
        tour: [],
      };
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    }) as typeof fetch;
    const out = path.join(await temporaryRoot('viewer-evaluation-configured-run-'), 'run');
    const report = await evaluateLive({
      out,
      authentication,
      jobs: ['J8'],
      retries: 0,
      request,
      log: (line) => logs.push(line),
    });
    expect(credentials.forProvider).toHaveBeenCalledExactlyOnceWith(configured);
    expect(request).toHaveBeenCalledOnce();
    expect(report.runs[0]?.graded).toBe(true);
    const answers = await readFile(report.files.answers, 'utf8');
    expect(answers).toContain('[redacted API key]');
    expect(answers).not.toContain(secret);
    expect(report.summary).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(logs.join('\n')).not.toContain(secret);
  }, 30_000);
});

describe('profile evaluation options', () => {
  it('starts with J1 and J7 once, with one retry, and makes inspection explicit', () => {
    expect(profileEvaluationOptions(['--run', '--out', '/tmp/result'])).toMatchObject({
      mode: 'run',
      jobs: ['J1', 'J7'],
      repeat: 1,
      retries: 1,
    });
    expect(profileEvaluationOptions(['--inspect'])).toMatchObject({ mode: 'inspect' });
    expect(
      profileEvaluationOptions(['--run', '--out', '/tmp/result', '--jobs', 'all', '--repeat', '3'])
        .jobs,
    ).toHaveLength(8);
    expect(() => profileEvaluationOptions(['--inspect', '--run'])).toThrow('Choose');
    expect(() => profileEvaluationOptions(['--inspect', '--out', '/tmp/result'])).toThrow(
      '--inspect takes only',
    );
  });

  it('rejects secret input, unbounded calls, duplicate jobs and incomplete requests', () => {
    expect(() =>
      profileEvaluationOptions(['--run', '--out', '/tmp/result', '--key', 'secret']),
    ).toThrow('Use --inspect');
    expect(() => profileEvaluationOptions(['--run'])).toThrow('--out');
    expect(() =>
      profileEvaluationOptions(['--run', '--out', '/tmp/result', '--repeat', '4']),
    ).toThrow('from 1 to 3');
    expect(() =>
      profileEvaluationOptions(['--run', '--out', '/tmp/result', '--retries', '3']),
    ).toThrow('from 0 to 2');
    expect(() =>
      profileEvaluationOptions(['--run', '--out', '/tmp/result', '--jobs', 'J1,J1']),
    ).toThrow('unique IDs');
  });
});
