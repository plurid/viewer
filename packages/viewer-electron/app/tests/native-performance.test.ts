import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import {
  assertPerformanceMode,
  performanceCandidate,
  performanceSampleCount,
  summarizePerformanceSample,
} from './native/scenarios/performance';

describe('native performance evidence', () => {
  it('rejects the public hidden performance entry before preparing or launching an application', async () => {
    const root = await temporaryRoot('viewer-performance-guard-');
    await expect(
      promisify(execFile)(process.execPath, ['--import', 'tsx', 'tests/electron-smoke.ts'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
          ...process.env,
          VIEWER_TEST_SCENARIO: 'performance',
          VIEWER_TEST_FOREGROUND: '0',
          VIEWER_TEST_PRESERVE: '1',
          VIEWER_TEST_BINARY: path.join(root, 'No application binary exists here'),
        },
        timeout: 5000,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining(
        'VIEWER_TEST_SCENARIO=performance requires VIEWER_TEST_FOREGROUND=1.',
      ),
    });
  });

  it('requires explicit foreground opt-in for the isolated performance scenario', () => {
    expect(() => assertPerformanceMode('performance', false)).toThrow('VIEWER_TEST_FOREGROUND=1');
    expect(() => assertPerformanceMode('performance', true)).not.toThrow();
    expect(() => assertPerformanceMode('milestones', false)).not.toThrow();
    expect(() => assertPerformanceMode(undefined, false)).not.toThrow();
    expect(performanceSampleCount).toBe(5);
  });

  it('retains ordered raw timings while preserving the original initial-frame exclusion', () => {
    const raw = {
      milliseconds: 1000,
      commits: 7,
      emissions: 2,
      frameIntervals: [999, 20, 5, 60, 10, 8],
      longTaskDurations: [71, 52],
    };
    const result = summarizePerformanceSample(raw);
    expect(result).toEqual({
      ...raw,
      excludedInitialFrames: 1,
      frames: 5,
      p95: 20,
      worst: 60,
      longTasks: 2,
      longestTask: 71,
    });
    expect(raw.frameIntervals).toEqual([999, 20, 5, 60, 10, 8]);
    result.frameIntervals[0] = 0;
    result.longTaskDurations[0] = 0;
    expect(raw.frameIntervals[0]).toBe(999);
    expect(raw.longTaskDurations[0]).toBe(71);
  });

  it('reports empty observations without producing undefined percentiles', () => {
    expect(
      summarizePerformanceSample({
        milliseconds: 0,
        commits: 0,
        emissions: 0,
        frameIntervals: [],
        longTaskDurations: [],
      }),
    ).toMatchObject({
      excludedInitialFrames: 0,
      frames: 0,
      p95: 0,
      worst: 0,
      longTasks: 0,
      longestTask: 0,
    });
  });

  it('identifies the packaged executable, archive and metadata rather than the working tree', async () => {
    const root = await temporaryRoot('viewer-performance-evidence-');
    const contents = path.join(root, 'Generated.app', 'Contents');
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.join(contents, 'Resources'));
    const binary = path.join(contents, 'MacOS/Viewer');
    const archive = path.join(contents, 'Resources/app.asar');
    await writeFile(binary, 'Generated executable fixture.');
    await writeFile(archive, 'Generated archive fixture.');
    await writeFile(path.join(contents, 'Info.plist'), 'Generated metadata fixture.');

    const before = await performanceCandidate(binary);
    expect(before.executableSha256).toBe(
      createHash('sha256').update('Generated executable fixture.').digest('hex'),
    );
    expect(before.archiveSha256).toBe(
      createHash('sha256').update('Generated archive fixture.').digest('hex'),
    );
    expect(before.infoPlistSha256).toBe(
      createHash('sha256').update('Generated metadata fixture.').digest('hex'),
    );
    expect(await performanceCandidate(binary)).toEqual(before);

    await writeFile(archive, 'A changed generated archive fixture.');
    const after = await performanceCandidate(binary);
    expect(after.candidateSha256).not.toBe(before.candidateSha256);
    expect(after.archiveSha256).not.toBe(before.archiveSha256);
    expect(after.executableSha256).toBe(before.executableSha256);
    expect(after.infoPlistSha256).toBe(before.infoPlistSha256);
  });

  it('rejects a linked candidate component without modifying it', async () => {
    const root = await temporaryRoot('viewer-performance-link-');
    const contents = path.join(root, 'Generated.app', 'Contents');
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.join(contents, 'Resources'));
    const binary = path.join(contents, 'MacOS/Viewer');
    const archive = path.join(root, 'Retained archive');
    await writeFile(binary, 'Generated executable fixture.');
    await writeFile(archive, 'Generated archive fixture.');
    await symlink(archive, path.join(contents, 'Resources/app.asar'));
    await writeFile(path.join(contents, 'Info.plist'), 'Generated metadata fixture.');
    await expect(performanceCandidate(binary)).rejects.toThrow('regular files');
  });
});
