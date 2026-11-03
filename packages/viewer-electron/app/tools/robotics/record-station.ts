import type { CanvasActionInput } from '../../src/domain/canvases/actions';
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
import { stationStudySchema } from './station-contract';
import { reviewStationPlugin } from './station-review';

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
        film: 'plugin',
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
        cameraTimeScale: 1.75,
        stagedCanvasArrival: true,
        presentationNote:
          'Retained Meta responses through local JSON replay. Repair rounds condensed. One staged entrance of the revised interface. Exact qualified plugin code and attached library. The creation turn has no closing reply. Calculations run in the plugin; external qualification is separate from the product.',
      },
      null,
      2,
    ),
  );
const scope = (id: string) => `[data-canvas-id="${id}"]`;
const chat = (id: string) => `[data-conversation-id="${id}"]`;
try {
  app = await ownedApp(binary, profile, {
    mode: 'foreground',
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
  film = await filmControls(raw, root, {
    ready: '#target option',
    readyText: 'A1',
    scroll: 'aside',
  });
  const { main, ui, overlay, click, key, all, frame, take, beat, type } = film;
  const reveal = sessionReplay(main);
  const readCanvas = async (id: string) =>
    (await main.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id)))
      .document;
  const study = async (id: string) => stationStudySchema.parse((await readCanvas(id)).state.study);
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
  function excerpt(message: ChatMessage, text: string) {
    const start = message.text.lastIndexOf(text);
    assert.ok(start >= 0, 'Typed words must be an exact retained request excerpt.');
    prompts.push({
      messageID: message.id,
      sourceHash: digest(message.text),
      start,
      end: start + text.length,
      text,
    });
    return text;
  }
  async function send(id: string, stage: 'create' | 'refine' | 'branch', text: string) {
    session.arm(stage);
    await click(chat(id) + ' textarea[aria-label="Chat message"]', undefined, 'Ask Meta');
    await type(text, 3300);
    await key('Send · ⌘↵', 'Enter', 'Enter', 13, 4);
    await pending();
  }
  const createRequest = session.creationChat.messages.findLast(
    (m) => m.role === 'user' && m.text.includes('Add a compact per-target results table'),
  )!;
  const refineRequest = session.refinementChat.messages.findLast(
    (m) => m.role === 'user' && m.text.includes('Reserve the central mounting area:'),
  )!;
  const branchRequest = session.branchChat.messages.find(
    (m) => m.role === 'user' && m.text.includes('Compare the rear mounting point'),
  )!;
  assert.ok(createRequest && refineRequest && branchRequest);
  await frame('files');
  await take('01-project', async () => {
    await beat(
      'personal',
      "By twenty twenty-five, I'd written about a million lines of code. Since then, I've changed at most ten thousand lines, mostly configuration files.",
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
      "I still have projects to build. I'm spending less time inside individual files, and more time figuring out how everything should work together.",
      9,
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
    await beat('browser', 'A browser.', 1.8);
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
    await frame(sourcePlane);
    await beat('editor', 'An editor.', 1.8, async () => {
      await key('Edit · ⌘E', 'e', 'KeyE', 69, 4);
    });
  });
  await take('04-terminal', async () => {
    await frame('terminal');
    await beat('terminal', 'A terminal.', 2.8, async () => {
      await click('.terminal-plane .xterm-screen');
      await main.command('Input.insertText', { text: 'ls' });
      await key('Run · ↵', 'Enter', 'Enter', 13);
    });
  });
  await take('05-workspace', async () => {
    await beat(
      'keynote',
      'A browser. An editor. A terminal. Are you getting it? One workspace.',
      6.5,
      all,
    );
    await beat(
      'foundations',
      'I built Viewer on Plurid, my spatial framework. I was working on both before the hackathon.',
      7,
      async () => {
        await frame('conversation');
      },
    );
  });
  await take('06-create', async () => {
    await beat(
      'existing-plugin',
      'For this hackathon, I added a way for Meta to create specialized interfaces right here, alongside my files, browser and terminal.',
      10,
      async () => {
        await click(
          chat(initial.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Open the existing plugin',
        );
        const canvas = await ui.canvas(initial.id);
        assert.equal(
          await canvas.frame.evaluate(pageCall(() => !!document.querySelector('#perTarget'))),
          false,
        );
        await canvas.drag('#scene canvas', 0.5, 0.58, 12);
      },
    );
    await beat(
      'ask-meta',
      "Here, I'm extending a robot tool to find where the arm can reach all six tray slots.",
      9,
      async () => {
        await click(scope(initial.id) + ' button', 'Conversation', 'Ask for a change');
        await send(
          initial.conversationID,
          'create',
          excerpt(
            createRequest,
            'Add a compact per-target results table for the selected mounting point, showing target name, measured residual in mm and whether it meets the tolerance.',
          ),
        );
        await release();
        await pending();
        await reveal.coverCanvas();
        await click(
          chat(initial.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Use the revised plugin',
        );
        const canvas = await ui.canvas(initial.id);
        await reveal.arriveCanvas(canvas.frame, { stage: '#scene', panel: 'aside' });
        assert.equal(digest((await readCanvas(initial.id)).html), digest(session.creation.html));
      },
    );
  });
  await take('07-evaluate', async () => {
    await beat(
      'model-evaluates',
      "It adds the table, then runs the plugin's calculations for all four places we could mount the arm.",
      7.5,
      async () => {
        await release();
        await pending();
        await release();
        await until(
          () => readCanvas(initial.id),
          (d) => d.state.selected === 'central',
          'Meta selects Central',
        );
        const measured = await study(initial.id);
        assert.equal(measured.recommended, 'central');
        assert.equal(
          measured.candidates
            .find((c) => c.id === 'central')!
            .poses.filter((p) => p.withinTolerance).length,
          6,
        );
        evidence.push({ creation: measured });
      },
    );
    await beat(
      'central-result',
      'From the centre, it reaches all six slots. I can click a row to look at that position.',
      7.5,
      async () => {
        const canvas = await ui.canvas(initial.id);
        overlay.cue('Inspect target B3');
        await canvas.press('#perTarget tr:nth-child(6) button');
        await until(
          () => readCanvas(initial.id),
          (d) => (d.state.ui as { targetIndex: number }).targetIndex === 5,
          'selected target',
        );
        overlay.cue('');
        await screenshot(main, path.join(root, 'central.png'));
      },
    );
  });
  await take('08-change', async () => {
    await beat(
      'changed-constraint',
      'But now I need to keep the middle of the bench clear. I ask Meta to leave that area out.',
      8,
      async () => {
        await click(scope(initial.id) + ' button', 'Conversation', 'Return to the conversation');
        // The retained creation ends after an action, without a closing assistant message.
        await until(async () => session.exhausted, Boolean, 'end of retained creation');
        await click(chat(initial.conversationID) + ' .chat-stop', undefined, 'Finish this replay');
        await until(
          () => readChat(initial.conversationID),
          (d) => !Array.isArray(d) && d.status === 'stopped',
          'conversation stopped',
        );
        session.finishStoppedTurn();
        await until(
          async () => session.exhausted,
          (v) => !v,
          'local replay canceled',
        );
        await send(
          initial.conversationID,
          'refine',
          excerpt(
            refineRequest,
            'Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm, including its boundary. Use the existing control and bench overlay, and add an explanation of which candidates this restriction excludes.',
          ),
        );
        await release();
        await pending();
        await click(
          chat(initial.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Use the changed tool',
        );
        await ui.canvas(initial.id);
      },
    );
    await beat(
      'meta-revises',
      'It adds an explanation to the tool and runs the calculations again. This time, it recommends the front.',
      7.5,
      async () => {
        await release();
        await pending();
        await release();
        await pending();
        await release();
        await idle(initial.conversationID);
        const current = await readCanvas(initial.id);
        assert.equal(digest(current.html), digest(session.refinement.html));
        assert.equal(current.state.selected, 'front');
        assert.equal(current.state.reserved, true);
        const result = await study(initial.id);
        assert.equal(result.recommended, 'front');
        evidence.push({ refinement: result });
        await screenshot(main, path.join(root, 'front.png'));
      },
    );
  });
  const currentChat = await readChat(initial.conversationID);
  assert.ok(!Array.isArray(currentChat));
  const answer = currentChat.messages.findLast((m) => m.role === 'assistant')!;
  const quote = 'Recommended and selected: Front';
  const offset = answer.text.indexOf(quote);
  assert.ok(offset >= 0);
  let alternativeID = '',
    branchID = '';
  const beforeBranch = (await readCanvas(initial.id)).state;
  await take('09-alternative', async () => {
    await beat(
      'quote',
      "I'd like to check the rear too, so I select the recommendation and ask about it in a separate conversation.",
      8.5,
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
        await send(
          branchID,
          'branch',
          excerpt(branchRequest, 'Compare the rear mounting point with the front mounting point.'),
        );
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
      "The rear works, but I'd have to move the base another sixty-seven millimetres. I'll use the front.",
      8,
      async () => {
        await release();
        await pending();
        await release();
        await pending();
        await release();
        await idle(branchID);
        const result = await study(alternativeID);
        const front = result.candidates.find((c) => c.id === 'front')!;
        const rear = result.candidates.find((c) => c.id === 'rear')!;
        assert.ok(front.eligible && rear.eligible);
        assert.ok(Math.abs((rear.movement - front.movement) * 1000 - 67.261376) < 0.001);
        assert.equal((await readCanvas(alternativeID)).state.selected, 'rear');
        evidence.push({ alternative: result });
        const canvas = await ui.canvas(alternativeID);
        await canvas.frame.evaluate(
          pageCall(() =>
            document
              .querySelector('#mounts')!
              .scrollIntoView({ block: 'center', behavior: 'smooth' }),
          ),
        );
        await delay(650);
        await screenshot(main, path.join(root, 'rear.png'));
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
    await beat(
      'save-check',
      'Now I can save the result and the tool I used to get it.',
      5.5,
      async () => {
        const canvas = await ui.canvas(initial.id);
        await canvas.press('#export');
        await click(
          scope(initial.id) + ' .canvas-result button',
          'Save result…',
          'Review and save the result',
        );
        await ui.folder(path.join(root, 'Handoff'));
        await click('.viewer-file-picker footer .primary', undefined, 'Save the result');
      },
    );
    await beat('export-tool', '', 0, async () => {
      await click(scope(initial.id) + ' button', 'Export canvas…', 'Export the working tool');
      await ui.folder(path.join(root, 'Handoff'));
      await click('.viewer-file-picker footer .primary', undefined, 'Export');
      const names = await until(
        () => readdir(path.join(root, 'Handoff')),
        (names) => names.some((n) => n.startsWith('Viewer canvas ')),
        'export folder',
      );
      exported = path.join(
        root,
        'Handoff',
        names.find((n) => n.startsWith('Viewer canvas '))!,
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
      'When I reopen it, my settings are there and I can carry on using it.',
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
        const reopened = await readCanvas(importedID);
        assert.deepEqual(reopened.state, beforeBranch);
        assert.equal(digest(reopened.html), digest(session.refinement.html));
        await canvas.press('#perTarget tr:nth-child(1) button');
        evidence.push({ exported, importedID, reopened: reopened.state });
        await screenshot(main, path.join(root, 'reopened.png'));
      },
    );
  });
  await take('11-ending', async () => {
    await beat(
      'manage-tools',
      'I can find it again in the tool library, or make a copy when I need to try something different.',
      8,
      async () => {
        await click(scope(importedID) + ' button', 'Tool library', 'Manage project tools');
        await click('.tool-library tbody th button', undefined, 'Inspect a saved tool');
        await screenshot(main, path.join(root, 'tool-library.png'));
      },
    );
    await beat(
      'ending',
      "I want to be able to open any project and ask for the tools I need, right where I'm working.",
      8,
      all,
    );
  });
  const invoke = async (action: string, input: CanvasActionInput) => {
    const current = await readCanvas(importedID);
    const reply = await main.evaluate(
      pageCall(
        (id, revision, stateRevision, action, input) =>
          window.viewer.canvas({
            kind: 'invoke-action',
            id,
            revision,
            stateRevision,
            action,
            input,
          }),
        importedID,
        current.revision,
        current.stateRevision,
        action,
        input,
      ),
    );
    assert.equal(reply.actionRun?.status, 'completed');
    return reply.actionRun!.result;
  };
  const reopenedDocument = await readCanvas(importedID);
  const urdf = reopenedDocument.sources
    .find((s) => s.name.endsWith('.urdf'))!
    .data.evidence.find((e) => e.source === 'text')!.text!;
  const brief = reopenedDocument.sources
    .find((s) => s.name === 'station.json')!
    .data.evidence.find((e) => e.source === 'text')!.text!;
  const externalReview = await reviewStationPlugin(invoke, urdf, JSON.parse(brief), true);
  evidence.push({
    externalReview,
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
  if (film) await screenshot(film.main, path.join(root, 'failure.png')).catch(() => {});
  await writeFile(path.join(root, 'story-failure.txt'), message, { flag: 'wx' });
  console.error(message);
  throw error;
} finally {
  film?.dispose();
  if (app) await app.close(film?.main);
  await session.close();
  await save();
}
