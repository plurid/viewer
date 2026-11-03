import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import { recordFrames } from './record';
import type { Connection } from './record';
import { inputOverlay } from './input-overlay';
import { presentationControls } from '../robotics/presentation-controls';

/** One native capture owns its pointer cues, timing marks and unscaled source frames. */
export async function filmControls(
  raw: Connection,
  root: string,
  layout = { ready: '#view canvas', readyText: '', scroll: '#panel' },
) {
  const overlay = await inputOverlay(raw);
  const main = overlay.connection;
  const ui = presentationControls(main, overlay.mapPointer, layout);
  const clips: Record<string, unknown>[] = [];
  let marks: { seconds: number; action: string; narration: string }[] = [];
  let navigation: { destination: string; start: number; settled: number; end: number }[] = [];
  let cameraMotion: { start: number; end: number }[] = [];
  let motionStarted: number | undefined;
  let started = 0;
  let recording = false;
  // Observe actual camera motion so the edit can slow navigation without retiming tool work.
  await main.command('Runtime.addBinding', { name: 'viewerFilmCameraMotion' });
  const offMotion = main.onEvent((method, params) => {
    if (
      method !== 'Runtime.bindingCalled' ||
      params.name !== 'viewerFilmCameraMotion' ||
      !recording
    )
      return;
    const seconds = (performance.now() - started) / 1000;
    if (params.payload === 'moving') motionStarted ??= seconds;
    else if (motionStarted !== undefined) {
      cameraMotion.push({ start: motionStarted, end: seconds });
      motionStarted = undefined;
    }
  });
  await main.evaluate(
    pageCall(() => {
      const report = (window as typeof window & { viewerFilmCameraMotion(payload: string): void })
        .viewerFilmCameraMotion;
      let moving = false;
      new MutationObserver(() => {
        const current = !!document.querySelector('[data-plurid-motion]');
        if (current === moving) return;
        moving = current;
        report(moving ? 'moving' : 'settled');
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-plurid-motion'],
      });
    }),
  );
  function requireTake() {
    assert.ok(recording || clips.length === 0, 'Visible actions must stay inside a recorded take.');
  }
  async function atRest() {
    await until(
      () => main.evaluate(pageCall(() => !document.querySelector('[data-plurid-motion]'))),
      Boolean,
      'camera has settled',
    );
  }
  async function arrive(destination: string, start: number) {
    await atRest();
    const settled = (performance.now() - started) / 1000;
    await delay(750);
    if (recording)
      navigation.push({ destination, start, settled, end: (performance.now() - started) / 1000 });
  }
  async function click(selector: string, label?: string, cue = '', double = false, modifiers = 0) {
    requireTake();
    console.log(JSON.stringify({ click: label ?? selector }));
    const point = await until(
      () =>
        main.evaluate(
          pageCall(
            (selector, label) => {
              const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
                (el) =>
                  el.checkVisibility() &&
                  !el.matches(':disabled') &&
                  (!label || el.textContent?.trim() === label),
              );
              if (!el) return null;
              el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
              const r = el.getBoundingClientRect();
              for (const vertical of [0.5, 0.25, 0.75, 0.1, 0.9])
                for (const horizontal of [0.5, 0.25, 0.75, 0.1, 0.9]) {
                  const x = r.x + r.width * horizontal,
                    y = r.y + r.height * vertical;
                  if (
                    x > 0 &&
                    y > 0 &&
                    x < innerWidth &&
                    y < innerHeight &&
                    el.contains(document.elementFromPoint(x, y))
                  )
                    return { x, y };
                }
              return null;
            },
            selector,
            label,
          ),
        ),
      Boolean,
      'visible ' + (label ?? selector),
    );
    assert.ok(point);
    overlay.cue(cue);
    const from = overlay.position();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10,
        f = t * t * (3 - 2 * t);
      await main.command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + (point.x - from.x) * f,
        y: from.y + (point.y - from.y) * f,
      });
      await delay(18);
    }
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      for (const type of ['mousePressed', 'mouseReleased'])
        await main.command('Input.dispatchMouseEvent', {
          type,
          ...point,
          button: 'left',
          clickCount: n,
          modifiers,
        });
      if (double && n === 1) await delay(70);
    }
    await delay(350);
    await atRest();
    overlay.cue('');
  }
  async function key(cue: string, key: string, code: string, virtual: number, modifiers = 0) {
    requireTake();
    overlay.cue(cue);
    await ui.key(key, code, virtual, modifiers);
    await delay(650);
    overlay.cue('');
  }
  async function all() {
    requireTake();
    const start = (performance.now() - started) / 1000;
    await click('[aria-label="Commands (⌘K)"]');
    await main.command('Input.insertText', { text: 'Frame all planes' });
    await key('Frame all planes', 'Enter', 'Enter', 13);
    await arrive('workspace', start);
  }
  async function frame(id: string) {
    requireTake();
    const start = (performance.now() - started) / 1000;
    const selector = `[data-viewer-plane="${id}"] [aria-label="Frame plane"]`;
    if (recording) {
      const overviewID = await main.evaluate(
        pageCall((selector) => {
          const button = document.querySelector<HTMLElement>(selector);
          if (!button) throw Error('Missing framing control');
          const r = button.getBoundingClientRect();
          if (button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)))
            return null;
          const plane = button.closest<HTMLElement>('[data-plurid-plane]');
          if (!plane?.dataset.pluridPlane) throw Error('Missing overview destination');
          return plane.dataset.pluridPlane;
        }, selector),
      );
      if (overviewID) {
        const visible = await main.evaluate(
          pageCall((id) => {
            const button = document.querySelector<HTMLElement>(
              `[data-plurid-minimap-plane="${id}"]`,
            );
            return !!button?.checkVisibility();
          }, overviewID),
        );
        if (!visible) {
          await click('[aria-label="Commands (⌘K)"]');
          await main.command('Input.insertText', { text: 'Overview' });
          await key('Open workspace overview', 'Enter', 'Enter', 13);
        }
      }
      await click(
        overviewID ? `[data-plurid-minimap-plane="${overviewID}"]` : selector,
        undefined,
        overviewID ? 'Follow this plane in the overview' : 'Focus this plane',
      );
    } else
      await main.evaluate(
        pageCall((selector) => {
          const button = document.querySelector<HTMLButtonElement>(selector);
          if (!button) throw Error('Missing framing control');
          button.click();
        }, selector),
      );
    await arrive(id, start);
  }
  async function take(name: string, work: () => Promise<void>) {
    marks = [];
    navigation = [];
    cameraMotion = [];
    motionStarted = undefined;
    console.log('Recording ' + name);
    try {
      const result = await recordFrames(
        main,
        path.join(root, name),
        async () => {
          await work();
          await atRest();
        },
        {
          width: 2880,
          height: 1800,
          onStart() {
            overlay.reset();
            started = performance.now();
            recording = true;
          },
        },
      );
      assert.equal(motionStarted, undefined, 'Finish each camera move before ending the take.');
      clips.push({
        name,
        ...result,
        marks,
        navigation,
        cameraMotion,
        inputs: overlay.events.slice(),
      });
      console.log(JSON.stringify({ name, seconds: result.seconds, frames: result.frames }));
    } finally {
      recording = false;
    }
  }
  async function beat(action: string, narration: string, seconds: number, work = async () => {}) {
    marks.push({ seconds: (performance.now() - started) / 1000, action, narration });
    const time = performance.now();
    await work();
    await delay(Math.max(0, seconds * 1000 - (performance.now() - time)));
  }
  async function type(text: string, milliseconds: number) {
    const chunks = text.match(/.{1,6}/gs) ?? [];
    for (const chunk of chunks) {
      await main.command('Input.insertText', { text: chunk });
      await delay(milliseconds / chunks.length);
    }
  }
  return {
    main,
    overlay,
    ui,
    clips,
    click,
    key,
    all,
    frame,
    take,
    beat,
    type,
    dispose() {
      offMotion();
      overlay.dispose();
    },
  };
}
