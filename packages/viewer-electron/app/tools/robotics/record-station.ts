import type { ExperimentAPI } from '../../src/domain/robotics/experiment-canvases';
/** Film retained Meta decisions through native Viewer actions, without a cloud request. */
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import type { ChatMessage } from '../../src/domain/models/chat';
import { ownedApp, until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import { filmControls } from '../docs/film-controls';
import { sessionReplay } from '../docs/session-replay';
import { screenshot } from '../docs/record';
import { digest, saveEvidence } from './rehearsal';
import { stationFilmSession } from './station-film-session';

const { values } = parseArgs({ options: { run: { type: 'string' }, binary: { type: 'string' } } });
assert.ok(values.run && values.binary);
const session = await stationFilmSession(values.run);
const { root, profile, project, initial } = session;
const binary = path.resolve(values.binary);
const sourceFolder = path.join(project, 'Simulation/SO101');
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  favorites: [],
  recents: [],
  look: 'dark',
  activeWorkspace: 'project',
  openWindows: ['project'],
  workspaces: [
    {
      id: 'project',
      name: 'Six-slot station',
      panes: [
        {
          id: 'files',
          type: 'folder',
          path: sourceFolder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [sourceFolder],
          historyIndex: 0,
          sidebar: { visible: false, width: 200 },
        },
        {
          id: 'browser',
          type: 'browser',
          path: project,
          url: session.endpoint,
          title: 'Station brief',
        },
        { id: 'terminal', type: 'terminal', path: sourceFolder, profileID: 'login' },
        { id: 'conversation', type: 'chat', path: project, conversationID: initial.conversationID },
      ],
      roots: ['files', 'browser', 'terminal', 'conversation'],
      activePane: 'files',
      arrangement: {},
    },
  ],
};
await saveEvidence(path.join(profile, 'viewer-state-v1.json'), state);
console.log(JSON.stringify({ root, providerRequests: 0 }));
const evidence: unknown[] = [];
const prompts: unknown[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let film: Awaited<ReturnType<typeof filmControls>> | undefined;
const save = () =>
  writeFile(
    path.join(root, 'story-capture.json'),
    JSON.stringify(
      {
        film: 'station',
        root,
        profile,
        binary,
        sourceRun: values.run,
        providerRequests: 0,
        localReplayRequests: session.localRequests,
        responses: session.events,
        prompts,
        evidence,
        clips: film?.clips ?? [],
        width: 2880,
        height: 1800,
        sourceFormat: 'png',
        continuousNavigation: true,
        presentationNote:
          'Retained Meta responses through local JSON replay. Repair rounds condensed. Final generated revisions have separately retained presentation edits. Native controls and independent checks execute during capture.',
      },
      null,
      2,
    ),
  );
const scope = (id: string) => `[data-canvas-id="${id}"]`;
const chat = (id: string) => `[data-conversation-id="${id}"]`;
try {
  app = await ownedApp(binary, profile, {
    mode: 'hidden',
    mockKeychain: true,
    label: 'station-film',
    environment: { SHELL: '/bin/sh', ENV: '/dev/null', PS1: 'SO-101 $ ' },
  });
  const raw = await app.connect();
  await raw.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
    viewport: { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
  });
  await until(
    () => raw.evaluate(pageCall(() => !!document.querySelector('[data-viewer-plane="files"]'))),
    Boolean,
    'project workspace',
  );
  film = await filmControls(raw, root);
  const { main, ui, overlay, click, key, all, frame, take, beat, type } = film;
  const reveal = sessionReplay(main);
  const readCanvas = async (id: string) =>
    (
      await main.evaluate(
        pageCall(
          (id) => (window.viewer as unknown as ExperimentAPI).canvas({ kind: 'read', id }),
          id,
        ),
      )
    ).document;
  const report = async (id: string) =>
    (
      await main.evaluate(
        pageCall(
          (id) =>
            (window.viewer as unknown as ExperimentAPI).canvas({ kind: 'placement-report', id }),
          id,
        ),
      )
    ).placementReport;
  const readChat = (id: string) =>
    main.evaluate(pageCall((id) => window.viewer.chat({ kind: 'open', id }), id));
  const pending = () => until(async () => session.pending, Boolean, 'next retained response');
  const release = async () => {
    await pending();
    const count = session.completed;
    session.release();
    await until(async () => session.completed > count, Boolean, 'retained response delivered');
  };
  const idle = (id: string) =>
    until(
      () => readChat(id),
      (d) => !Array.isArray(d) && d.status === 'idle',
      'conversation complete',
    );
  const select = async (
    canvas: Awaited<ReturnType<typeof ui.canvas>>,
    selector: string,
    index: number,
  ) => {
    await canvas.press(selector);
    await ui.key('Home', 'Home', 36, 0, canvas.frame.sessionId);
    for (let i = 0; i < index; i++)
      await ui.key('ArrowDown', 'ArrowDown', 40, 0, canvas.frame.sessionId);
    await ui.key('Enter', 'Enter', 13, 0, canvas.frame.sessionId);
    await delay(400);
  };
  const planeFor = (selector: string) =>
    main.evaluate(
      pageCall((selector) => {
        let node = document.querySelector(selector);
        while (node) {
          const h = node.querySelector<HTMLElement>('[data-viewer-plane]');
          if (h) return h.dataset.viewerPlane;
          node = node.parentElement;
        }
      }, selector),
    );
  const inspector = async (id: string, open: boolean) => {
    const current = await main.evaluate(
      pageCall((selector) => {
        const summary = [...document.querySelectorAll<HTMLElement>(selector + ' summary')].find(
          (s) => s.textContent?.startsWith('Station study'),
        );
        return summary
          ? {
              label: summary.textContent!.trim(),
              open: summary.parentElement?.hasAttribute('open'),
            }
          : null;
      }, scope(id)),
    );
    assert.ok(current);
    if (current.open !== open)
      await click(scope(id) + ' summary', current.label, 'Viewer checks the result');
  };
  const conclusion = async (id: string) => {
    await main.evaluate(
      pageCall((selector) => {
        const rows = [
          ...document.querySelectorAll<HTMLElement>(selector + ' .canvas-robot-report p'),
        ];
        const conclusion =
          rows.find((p) => p.textContent?.startsWith('Compared with')) ??
          rows.find((p) => p.textContent?.startsWith('Least movement'));
        if (!conclusion) throw Error('Missing comparison conclusion');
        conclusion.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }, scope(id)),
    );
    await delay(1000);
  };
  function excerpt(message: ChatMessage, end: number) {
    assert.ok(end > 0);
    const text = message.text.slice(0, end);
    prompts.push({ messageID: message.id, sourceHash: digest(message.text), start: 0, end, text });
    return text;
  }
  async function send(id: string, stage: 'create' | 'refine' | 'branch', text: string) {
    session.arm(stage);
    await click(chat(id) + ' textarea[aria-label="Chat message"]', undefined, 'Ask Meta');
    await type(text, 3300);
    await key('Send · ⌘↵', 'Enter', 'Enter', 13, 4);
    await pending();
  }
  const createRequest = session.creationChat.messages.find(
    (m) => m.id === 'd8f4c4e7-86d7-4867-ba09-496b95d9226a',
  )!;
  const refineRequest = session.refinementChat.messages.find(
    (m) => m.id === '1951a9dd-9624-4b82-822b-53caa37d7de8',
  )!;
  const branchRequest = session.branchChat.messages.find(
    (m) => m.id === 'ee1524da-632b-4b41-b385-48db69b0f9be',
  )!;
  assert.ok(createRequest && refineRequest && branchRequest);
  await frame('files');
  await take('01-project', async () => {
    await beat(
      'personal',
      'Until twenty twenty-five, I had written about a million lines of code. Since then, I have modified ten thousand at most, mostly configuration.',
      11,
      async () => {
        await delay(1200);
        await click(
          '[data-file-path$="/so101_new_calib.urdf"]',
          undefined,
          'Open source in a linked plane',
          true,
          1,
        );
        await delay(3000);
        await key('Back · ⌥⌘↑', 'ArrowUp', 'ArrowUp', 38, 5);
      },
    );
    await beat(
      'project-thinking',
      'I still build projects. But my attention has moved: how the pieces connect, what changes what, and whether the result works.',
      10,
      async () => {
        await click('[data-file-path$="/assets"]');
        await key('Expand folder · →', 'ArrowRight', 'ArrowRight', 39);
        await click(
          '[data-file-path$="/upper_arm_so101_v1.stl"]',
          undefined,
          'Open linked geometry',
          true,
          1,
        );
      },
    );
  });
  await take('02-browser', async () => {
    await all();
    await frame('browser');
    await beat('browser', 'A browser.', 1.6);
  });
  const sourcePlane = await main.evaluate(
    pageCall(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-viewer-plane]')].find(
          (el) =>
            el.textContent?.includes('so101_new_calib.urdf') &&
            el.querySelector('[aria-label="Frame plane"]'),
        )?.dataset.viewerPlane,
    ),
  );
  assert.ok(sourcePlane);
  await take('03-editor', async () => {
    await all();
    await frame(sourcePlane);
    await beat('editor', 'An editor.', 1.6, async () => {
      await key('Edit · ⌘E', 'e', 'KeyE', 69, 4);
    });
  });
  await take('04-terminal', async () => {
    await all();
    await frame('terminal');
    await beat('terminal', 'A terminal.', 2.6, async () => {
      await click('.terminal-plane .xterm-screen');
      await main.command('Input.insertText', { text: 'ls' });
      await key('Run · ↵', 'Enter', 'Enter', 13);
    });
  });
  await take('05-workspace', async () => {
    await beat(
      'keynote',
      'A browser. An editor. A terminal. Are you getting it? One workspace.',
      7,
      all,
    );
    await beat(
      'foundations',
      'This is Viewer, built on Plurid. Both existed before the hackathon.',
      5.5,
      async () => {
        await frame('conversation');
      },
    );
  });
  await take('06-create', async () => {
    await beat(
      'ask-meta',
      'For the hackathon, I gave Meta tools of its own. Here, it must place a robot that can reach six tray slots.',
      9,
      async () => {
        await send(
          initial.conversationID,
          'create',
          excerpt(createRequest, createRequest.text.indexOf(' Use the attached')),
        );
        await release();
        await pending();
        await reveal.coverCanvas();
        await click(
          chat(initial.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Open the generated tool',
        );
        const canvas = await ui.canvas(initial.id);
        await reveal.revealCanvas(canvas.frame, 'create', { stage: '#viewWrap', panel: '#panel' });
      },
    );
    await beat(
      'tool-appears',
      'It turns the robot files and station brief into this working interface.',
      5.5,
    );
    // The saved creation repair evaluates an incomplete study once on initialization.
    await until(
      async () => (await readCanvas(initial.id)).state.study,
      (study) => JSON.stringify(study).includes('B3'),
      'initialization repair completes',
    );
    await screenshot(main, path.join(root, 'creation.png'));
  });
  await take('07-evaluate', async () => {
    await beat(
      'model-evaluates',
      'Meta runs the tool. Four mounting points. Six targets each. Viewer checks the computed poses against the source robot.',
      10,
      async () => {
        await release();
        await pending();
        await delay(300);
        await release();
        await pending();
        const result = await report(initial.id);
        assert.equal(result?.status, 'checked');
        evidence.push({ creation: result });
        await inspector(initial.id, true);
        await release();
        await idle(initial.conversationID);
      },
    );
    await beat(
      'central-result',
      'Central reaches all six with the shortest move. I select it.',
      6,
      async () => {
        await inspector(initial.id, false);
        const canvas = await ui.canvas(initial.id);
        overlay.cue('Select Central');
        await select(canvas, '#selMount', 1);
        await canvas.press('#bSelect');
        await select(canvas, '#selView', 1);
        await select(canvas, '#selTarget', 5);
        await canvas.press('#bCheck');
        await until(
          () => report(initial.id),
          (result) => result?.status === 'checked' && result.input.selected === 'central',
          'selected Central is checked',
        );
        overlay.cue('');
        assert.equal(
          ((await readCanvas(initial.id)).state.study as { selected?: string }).selected,
          'central',
        );
        await screenshot(main, path.join(root, 'central.png'));
      },
    );
  });
  await take('08-change', async () => {
    await beat(
      'changed-constraint',
      'Now the central area is needed for something else. I ask Meta to reserve it.',
      8,
      async () => {
        await click(scope(initial.id) + ' button', 'Conversation', 'Return to the conversation');
        await send(
          initial.conversationID,
          'refine',
          excerpt(refineRequest, refineRequest.text.indexOf(' Keep the same')),
        );
        await release();
        await pending();
        await click(
          chat(initial.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Use the revised tool',
        );
        await ui.canvas(initial.id);
      },
    );
    await beat(
      'meta-revises',
      'It adds the restriction to the interface, evaluates again, and selects Front.',
      8,
      async () => {
        for (let i = 0; i < 3; i++) {
          await release();
          await pending();
        }
        await delay(400);
      },
    );
    await beat(
      'front-result',
      'The choice changes for a reason: six targets reached, within a millimetre, with the central mounting point excluded.',
      8.5,
      async () => {
        await release();
        await pending();
        await release();
        await idle(initial.conversationID);
        const result = await report(initial.id);
        assert.ok(result?.status === 'checked');
        assert.equal(result.recommended, 'front');
        assert.equal(result.input.selected, 'front');
        evidence.push({ refinement: result });
        await inspector(initial.id, true);
        await conclusion(initial.id);
        await screenshot(main, path.join(root, 'front-checked.png'));
        await delay(1000);
        await inspector(initial.id, false);
      },
    );
  });
  const currentChat = await readChat(initial.conversationID);
  assert.ok(!Array.isArray(currentChat));
  const answer = currentChat.messages.findLast((m) => m.role === 'assistant')!;
  const quote = 'Recommended: front.';
  const offset = answer.text.indexOf(quote);
  assert.ok(offset >= 0);
  let alternativeID = '',
    branchID = '';
  const beforeBranch = (await readCanvas(initial.id)).state;
  await take('09-alternative', async () => {
    await beat(
      'quote',
      'What about the rear mounting point? I branch from that recommendation and ask Meta to test it.',
      9,
      async () => {
        await click(scope(initial.id) + ' button', 'Conversation', 'Return to the recommendation');
        await reveal.focusQuote(chat(initial.conversationID), answer.id);
        await main.evaluate(
          pageCall(
            (id, start, length) => {
              const node = document.querySelector(`[data-chat-text="${id}"]`)!.firstChild!;
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, start + length);
              const selection = getSelection()!;
              selection.removeAllRanges();
              selection.addRange(range);
              node.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            },
            answer.id,
            offset,
            quote.length,
          ),
        );
        await click('.chat-quote-action', 'Ask about selection', 'Branch from this recommendation');
        branchID =
          (await until(
            () =>
              main.evaluate(
                pageCall(
                  (original) =>
                    [...document.querySelectorAll<HTMLElement>('[data-conversation-id]')]
                      .map((e) => e.dataset.conversationId!)
                      .find((id) => id !== original),
                  initial.conversationID,
                ),
              ),
            Boolean,
            'quoted conversation',
          )) ?? '';
        assert.ok(branchID);
        await send(branchID, 'branch', excerpt(branchRequest, branchRequest.text.indexOf('.') + 1));
        await click(chat(branchID) + ' .chat-toolbar button', 'Canvas', 'Open the alternative');
        const branchDocument = await readChat(branchID);
        assert.ok(!Array.isArray(branchDocument) && branchDocument.canvasID);
        alternativeID = branchDocument.canvasID;
        await ui.canvas(alternativeID);
        await release();
        await pending();
      },
    );
    await beat(
      'comparison',
      'Rear passes too. But it needs a sixty-seven millimetre longer move. Front wins this comparison.',
      8.5,
      async () => {
        await release();
        await pending();
        await release();
        await idle(branchID);
        const comparison = await main.evaluate(
          pageCall(
            (id) =>
              (window.viewer as unknown as ExperimentAPI).canvas({
                kind: 'placement-comparison',
                id,
              }),
            alternativeID,
          ),
        );
        assert.equal(comparison.placementComparison?.status, 'compared');
        evidence.push({ comparison: comparison.placementComparison });
        await inspector(alternativeID, true);
        await conclusion(alternativeID);
        await screenshot(main, path.join(root, 'comparison.png'));
      },
    );
  });
  assert.deepEqual((await readCanvas(initial.id)).state, beforeBranch);
  const originalPlane = await planeFor(scope(initial.id));
  assert.ok(originalPlane);
  let exported = '',
    importedID = '';
  await take('10-handoff', async () => {
    await all();
    await frame(originalPlane);
    await inspector(initial.id, true);
    await beat(
      'save-check',
      'I keep the checked result and the working tool together.',
      5.5,
      async () => {
        await click(
          scope(initial.id) + ' button',
          'Save check JSON…',
          'Save independent measurements',
        );
        await ui.folder(path.join(root, 'Handoff'));
        await click('.viewer-file-picker footer .primary', undefined, 'Save check');
      },
    );
    await beat('export-tool', '', 0, async () => {
      await inspector(initial.id, false);
      await click(scope(initial.id) + ' button', 'Export canvas…', 'Export the working tool');
      await ui.folder(path.join(root, 'Handoff'));
      await click('.viewer-file-picker footer .primary', undefined, 'Export');
      const files = await until(
        () => readdir(path.join(root, 'Handoff')),
        (names) => names.some((n) => n.startsWith('Viewer canvas ')),
        'export folder',
      );
      exported = path.join(
        root,
        'Handoff',
        files.find((n) => n.startsWith('Viewer canvas '))!,
      );
    });
    await beat('reopen-navigation', '', 0, async () => {
      await key('Back · ⌥⌘↑', 'ArrowUp', 'ArrowUp', 38, 5);
      await click(scope(initial.id) + ' button', 'Conversation');
      await click(chat(initial.conversationID) + ' .chat-toolbar button', 'Open canvas…');
      await ui.folder(exported);
    });
    await beat(
      'reopen',
      'Reopen it, and the inputs, controls and checked decision come with it.',
      6.5,
      async () => {
        await click('.viewer-file-picker footer .primary', undefined, 'Reopen the saved tool');
        importedID =
          (await until(
            () =>
              main.evaluate(
                pageCall(
                  (known) =>
                    [...document.querySelectorAll<HTMLElement>('[data-canvas-id]')]
                      .map((e) => e.dataset.canvasId!)
                      .find((id) => !known.includes(id)),
                  [initial.id, alternativeID],
                ),
              ),
            Boolean,
            'reopened canvas',
          )) ?? '';
        assert.ok(importedID);
        const canvas = await ui.canvas(importedID);
        assert.deepEqual((await readCanvas(importedID)).state.study, beforeBranch.study);
        overlay.cue('Inspect another target');
        await select(canvas, '#selTarget', 5);
        overlay.cue('');
        const saved = await report(importedID);
        assert.equal(saved?.status, 'checked');
        evidence.push({ exported, importedID, reopened: saved });
        await screenshot(main, path.join(root, 'reopened.png'));
      },
    );
  });
  await take('11-ending', () =>
    beat(
      'ending',
      "Meta wrote the tool, used it, and revised it when the job changed. I didn't open a robotics application. I opened my project and asked for what I needed.",
      12.5,
      async () => {
        await delay(8500);
        await all();
      },
    ),
  );
  evidence.push({
    originalInputsPreservedByBranch: true,
    quote: { messageID: answer.id, start: offset, end: offset + quote.length, text: quote },
    presentation: reveal.events,
  });
  await save();
  await saveEvidence(path.join(root, 'story-completed.json'), {
    status: 'passed',
    root,
    providerRequests: 0,
    localReplayRequests: session.localRequests,
  });
  console.log(JSON.stringify({ status: 'passed', root }));
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await writeFile(path.join(root, 'story-failure.txt'), message, { flag: 'wx' });
  console.error(message);
  throw error;
} finally {
  film?.dispose();
  if (app) await app.close(film?.main);
  await session.close();
  await save();
}
