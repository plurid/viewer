import { describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { stationTransport } from '../tools/robotics/station-transport';
import { authorizeStationRun } from '../tools/robotics/station-authorization';

async function fixture(requestsPerSession = 8) {
  const root = await realpath(await temporaryRoot('viewer-station-cap-'));
  const folder = path.join(root, 'sessions/01');
  await mkdir(path.join(root, 'sessions'));
  await writeFile(
    path.join(root, 'plan.json'),
    JSON.stringify({ contract: 'generated-domain-v1', prompts: { create: 'test fixture' } }),
  );
  await authorizeStationRun(root, {
    sessions: 3,
    requestsPerSession,
    approval: 'Synthetic test allowance; mock transport only.',
  });
  await mkdir(folder);
  await writeFile(path.join(root, 'active-session.json'), JSON.stringify({ session: 1 }));
  await writeFile(path.join(folder, 'started.json'), '{}');
  return { root, folder };
}
const url = 'https://api.meta.ai/v1/chat/completions';
const options = { method: 'POST', body: '{}', headers: { authorization: 'Bearer test-secret' } };

describe('native station request allowance', () => {
  it('counts rejected and canceled requests, preserves the cap over restart, and omits secrets', async () => {
    const { root, folder } = await fixture();
    const upstream = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('test-secret aborted'))
      .mockImplementation(async () =>
        Response.json({ error: 'test-secret rejected' }, { status: 429 }),
      );
    const first = stationTransport(root, upstream);
    await expect(first(url, options)).rejects.toThrow('aborted');
    for (let index = 0; index < 3; index++) expect((await first(url, options)).status).toBe(429);
    const restarted = stationTransport(root, upstream);
    for (let index = 0; index < 4; index++) await restarted(url, options);
    await expect(restarted(url, options)).rejects.toThrow('exhausted');
    expect(upstream).toHaveBeenCalledTimes(8);
    expect(await readFile(path.join(folder, 'request-01-error.json'), 'utf8')).not.toContain(
      'test-secret',
    );
    expect(await readFile(path.join(folder, 'request-02-response.json'), 'utf8')).not.toContain(
      'test-secret',
    );
    expect(await readFile(path.join(folder, 'request-01.json'), 'utf8')).not.toContain(
      'authorization',
    );
  });

  it('refuses a completed session, a fourth session and other provider routes before network I/O', async () => {
    const { root, folder } = await fixture();
    const upstream = vi.fn<typeof fetch>();
    const request = stationTransport(root, upstream);
    await expect(request('https://api.meta.ai/v1/models', options)).rejects.toThrow('approved');
    await writeFile(path.join(folder, 'result.json'), '{}');
    await expect(request(url, options)).rejects.toThrow('finished');
    await writeFile(path.join(root, 'active-session.json'), JSON.stringify({ session: 4 }));
    await expect(request(url, options)).rejects.toThrow('exhausted');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('resumes only an explicit unfinished continuation without refunding earlier requests', async () => {
    const { root, folder } = await fixture();
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    const first = stationTransport(root, upstream);
    for (let index = 0; index < 5; index++) await first(url, options);
    await writeFile(path.join(folder, 'result.json'), JSON.stringify({ status: 'failed' }));
    const continuation = path.join(folder, 'continuations/01');
    await mkdir(continuation, { recursive: true });
    await writeFile(path.join(continuation, 'started.json'), '{}');
    const resumed = stationTransport(root, upstream);
    for (let index = 0; index < 3; index++) await resumed(url, options);
    await expect(resumed(url, options)).rejects.toThrow('exhausted');
    expect(upstream).toHaveBeenCalledTimes(8);
    await writeFile(path.join(continuation, 'result.json'), '{}');
    await expect(resumed(url, options)).rejects.toThrow('finished');
  });

  it('honours a smaller allowance and rejects budget or prompt changes before network I/O', async () => {
    const { root } = await fixture(2);
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    const request = stationTransport(root, upstream);
    await request(url, options);
    await request(url, options);
    await expect(stationTransport(root, upstream)(url, options)).rejects.toThrow('exhausted');
    await writeFile(
      path.join(root, 'budget.json'),
      JSON.stringify({ sessions: 3, requestsPerSession: 8 }),
    );
    await expect(request(url, options)).rejects.toThrow('changed after approval');
    expect(upstream).toHaveBeenCalledTimes(2);
    const other = await fixture();
    await writeFile(
      path.join(other.root, 'plan.json'),
      JSON.stringify({ contract: 'generated-domain-v1', prompts: {} }),
    );
    await expect(stationTransport(other.root, upstream)(url, options)).rejects.toThrow(
      'changed after approval',
    );
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('cannot send from an unapproved prepared run or replenish a started run', async () => {
    const root = await realpath(await temporaryRoot('viewer-unapproved-station-'));
    await writeFile(path.join(root, 'active-session.json'), JSON.stringify({ session: 1 }));
    const upstream = vi.fn<typeof fetch>();
    await expect(stationTransport(root, upstream)(url, options)).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
    const fixtureRun = await fixture();
    await expect(
      authorizeStationRun(fixtureRun.root, {
        sessions: 3,
        requestsPerSession: 8,
        approval: 'repeat',
      }),
    ).rejects.toThrow('cannot be reauthorized');
  });
});
