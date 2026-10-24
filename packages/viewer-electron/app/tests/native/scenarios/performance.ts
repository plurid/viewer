/** Foreground observations, not latency assertions or hidden-compositor measurements. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { hashFile } from '../../../tools/filesystem/fingerprints';
import type { NativeScenarioHarness } from '../runtime/harness';

export const performanceSampleCount = 5;
export const performanceWorkloadVersion = 1;

export interface PerformanceContext {
  foreground: boolean;
  binary: string;
  files: string;
  evidenceDirectory: string;
}

export interface PerformanceHarness extends NativeScenarioHarness {
  key(key: string, code: string, modifiers?: number, commands?: string[]): Promise<void>;
  contextMenu(selector: string): Promise<void>;
  paletteCommand(label: string): Promise<void>;
  settleCamera(): Promise<void>;
}

export interface RawPerformanceSample {
  milliseconds: number;
  commits: number;
  emissions: number;
  frameIntervals: number[];
  longTaskDurations: number[];
}

export interface PerformanceSample extends RawPerformanceSample {
  excludedInitialFrames: number;
  frames: number;
  p95: number;
  worst: number;
  longTasks: number;
  longestTask: number;
}

export interface PerformanceCandidate {
  binary: string;
  executableSha256: string;
  archiveSha256: string;
  infoPlistSha256: string;
  candidateSha256: string;
}

/** This runs before fixture creation or application launch in the native entry point. */
export function assertPerformanceMode(scenario: string | undefined, foreground: boolean): void {
  if (scenario === 'performance' && !foreground)
    throw new Error('VIEWER_TEST_SCENARIO=performance requires VIEWER_TEST_FOREGROUND=1.');
}

/** Preserve acquisition order; sorting a copy prevents percentiles from destroying raw evidence. */
export function summarizePerformanceSample(raw: RawPerformanceSample): PerformanceSample {
  // The initial RAF interval remains in the evidence but is excluded exactly as
  // in the original probe, because its start need not coincide with a paint.
  const ordered = raw.frameIntervals.slice(1).sort((left, right) => left - right);
  return {
    ...raw,
    frameIntervals: [...raw.frameIntervals],
    longTaskDurations: [...raw.longTaskDurations],
    excludedInitialFrames: raw.frameIntervals.length ? 1 : 0,
    frames: ordered.length,
    p95: ordered[Math.floor((ordered.length - 1) * 0.95)] ?? 0,
    worst: ordered.at(-1) ?? 0,
    longTasks: raw.longTaskDurations.length,
    longestTask: Math.max(0, ...raw.longTaskDurations),
  };
}

/** Hash the actual packaged candidate selected by VIEWER_TEST_BINARY, including its app data. */
export async function performanceCandidate(binary: string): Promise<PerformanceCandidate> {
  const executable = path.resolve(binary);
  const contents = path.dirname(path.dirname(executable));
  const checkedHash = async (file: string) => {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink())
      throw new Error('Performance candidate components must be regular files: ' + file);
    const hash = await hashFile(file);
    const after = await lstat(file);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('The performance candidate changed while hashing: ' + file);
    return hash;
  };
  const [executableSha256, archiveSha256, infoPlistSha256] = await Promise.all([
    checkedHash(executable),
    checkedHash(path.join(contents, 'Resources/app.asar')),
    checkedHash(path.join(contents, 'Info.plist')),
  ]);
  return {
    binary: executable,
    executableSha256,
    archiveSha256,
    infoPlistSha256,
    candidateSha256: createHash('sha256')
      .update(JSON.stringify([executableSha256, archiveSha256, infoPlistSha256]))
      .digest('hex'),
  };
}

const beginProbe = String.raw`(() => {
  const probe = window.__qaPerf = {
    frames: [],
    tasks: [],
    commits: window.__qaCommits,
    emissions: 0,
    started: performance.now(),
    stopped: false,
  };
  let last = performance.now();
  const frame = time => {
    if (probe.stopped) return;
    probe.frames.push(time - last);
    last = time;
    probe.raf = requestAnimationFrame(frame);
  };
  probe.raf = requestAnimationFrame(frame);
  probe.off = window.__qaEngine.store.subscribe(() => probe.emissions++);
  probe.observer = new PerformanceObserver(list => {
    probe.tasks.push(...list.getEntries().map(entry => entry.duration));
  });
  probe.observer.observe({ entryTypes: ['longtask'] });
})()`;

const finishProbe = String.raw`(() => {
  const probe = window.__qaPerf;
  probe.stopped = true;
  cancelAnimationFrame(probe.raf);
  probe.off();
  probe.tasks.push(...probe.observer.takeRecords().map(entry => entry.duration));
  probe.observer.disconnect();
  const result = {
    milliseconds: performance.now() - probe.started,
    commits: window.__qaCommits - probe.commits,
    emissions: probe.emissions,
    frameIntervals: [...probe.frames],
    longTaskDurations: [...probe.tasks],
  };
  delete window.__qaPerf;
  return result;
})()`;

const cancelProbe = String.raw`(() => {
  const probe = window.__qaPerf;
  if (!probe) return;
  probe.stopped = true;
  cancelAnimationFrame(probe.raf);
  probe.off?.();
  probe.observer?.disconnect();
  delete window.__qaPerf;
})()`;

/** Both baseline and candidate runs execute these same 24-event workloads. */
export async function profileNativeInteractions(
  harness: PerformanceHarness,
  context: PerformanceContext,
): Promise<void> {
  assertPerformanceMode('performance', context.foreground);
  const { evaluate, command, contextMenu, key, paletteCommand, settleCamera } = harness;
  const candidate = await performanceCandidate(context.binary);
  const harnessFiles = [
    ['performance', import.meta.url],
    ['fixtures', new URL('../fixtures/scenarios.ts', import.meta.url).href],
    ['runner', new URL('../../electron-smoke.ts', import.meta.url).href],
    ['reactProbe', new URL('../../react-commits.ts', import.meta.url).href],
  ] as const;
  const harnessSha256 = Object.fromEntries(
    await Promise.all(
      harnessFiles.map(async ([name, url]) => [name, await hashFile(fileURLToPath(url))]),
    ),
  );
  const samples: (PerformanceSample & { workload: string; sample: number })[] = [];
  await harness.until(
    () => evaluate<{ running: boolean }>('window.viewer.indexStatus()'),
    (status) => !status.running,
    'idle file index before native performance observations',
  );
  const environment = await evaluate<{
    visibility: string;
    viewport: { width: number; height: number; pixelRatio: number };
    screen: { width: number; height: number; colorDepth: number };
    planes: number;
  }>(`({
    visibility: document.visibilityState,
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    planes: window.__qaEngine.inspect().planes.length,
  })`);
  assert.equal(environment.visibility, 'visible', 'Performance requires a visible native window');
  const capturedAt = new Date().toISOString();
  let candidateAfter: PerformanceCandidate | undefined;
  let failure: string | undefined;

  const measure = async (workload: string, sample: number, run: () => Promise<void>) => {
    let failed = false;
    try {
      await evaluate(beginProbe);
      await run();
      const result = summarizePerformanceSample(await evaluate<RawPerformanceSample>(finishProbe));
      samples.push({ workload, sample, ...result });
      const { frameIntervals: _frames, longTaskDurations: _tasks, ...summary } = result;
      console.log('Native performance:', JSON.stringify({ workload, sample, ...summary }));
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await evaluate(cancelProbe);
      } catch (error) {
        if (!failed) throw error;
        console.error('Performance probe cleanup also failed:', error);
      }
    }
  };

  try {
    for (let sample = 1; sample <= performanceSampleCount; sample++) {
      const camera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
      await measure(`menu-wheel-${sample}`, sample, async () => {
        const file = path.join(context.files, 'README.md');
        await contextMenu(`[data-file-path=${JSON.stringify(file)}]`);
        const point = await evaluate<{ x: number; y: number }>(
          `(() => {
            const rect = document.querySelector('.context-menu .command-results').getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          })()`,
        );
        for (let index = 0; index < 24; index++) {
          await command('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            buttons: 0,
            x: point.x + (index % 2),
            y: point.y,
          });
          await command('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            deltaX: 0,
            deltaY: index % 12 < 6 ? 60 : -60,
            ...point,
          });
          await delay(20);
        }
      });
      assert.equal(
        await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
        camera,
        'Contextual wheel scrolling cannot move the spatial camera',
      );
      await key('Escape', 'Escape');
    }

    for (let sample = 1; sample <= performanceSampleCount; sample++) {
      const before = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
      const point = await evaluate<{ x: number; y: number }>(
        `(() => {
          const rect = document.querySelector('.workspace-surface').getBoundingClientRect();
          return { x: rect.x + 14, y: rect.y + rect.height / 2 };
        })()`,
      );
      await measure('camera-wheel', sample, async () => {
        for (let index = 0; index < 24; index++) {
          await command('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            modifiers: 8,
            deltaX: 4,
            deltaY: 8,
            ...point,
          });
          await delay(20);
        }
        await settleCamera();
      });
      assert.notEqual(
        await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
        before,
        'Camera profile must exercise actual rotation',
      );
      await paletteCommand('Frame plane');
      await settleCamera();
      await key('Escape', 'Escape');
    }
    candidateAfter = await performanceCandidate(context.binary);
    assert.deepEqual(
      candidateAfter,
      candidate,
      'The measured native candidate must remain unchanged',
    );
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw error;
  } finally {
    const evidence = path.join(context.evidenceDirectory, 'native-reliability-performance.json');
    await writeFile(
      evidence,
      JSON.stringify(
        {
          version: 2,
          workloadVersion: performanceWorkloadVersion,
          harnessSha256,
          capturedAt,
          finishedAt: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          kernel: os.release(),
          node: process.versions.node,
          mode: 'foreground',
          candidate,
          candidateAfter,
          environment,
          repeatsPerWorkload: performanceSampleCount,
          fixtureFiles: context.files,
          samples,
          status: failure ? 'failed' : 'completed',
          failure,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log('Native performance evidence:', evidence);
  }
}
