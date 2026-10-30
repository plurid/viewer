/** Existing Git, comparison, Chat-draft and independent-window acceptance scenario. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SavedState } from '../../../src/domain/contracts';
import type { NativeScenarioHarness } from '../runtime/harness';
import { buttonState, countOf, exists, pressButton, textOf, valueOf } from '../runtime/page';
import { pageCall } from '../runtime/page-function';

export interface MilestonesContext {
  files: string;
  profile: string;
  stateFile: string;
  binary: string;
  debuggerOrigin: string;
  initialRootID: string;
}

export interface MilestonesHarness extends NativeScenarioHarness {
  click(selector: string, count?: number, modifiers?: number): Promise<void>;
  settleCamera(): Promise<void>;
  snapshot(name: string, clip?: Record<string, number>): Promise<string>;
  paletteCommand(label: string): Promise<void>;
  reloadPage(): Promise<void>;
  captureEngine(): Promise<void>;
}

const execNative = promisify(execFile);

/** The engine ref the native smoke leaves on the page. */
interface EngineWindow {
  __qaEngine: {
    camera: { dock(planeID: string, options: { animate: boolean }): unknown };
    tree: {
      get(): { planeID: string; routeDivisions: { plane: { parameters: { id: string } } } }[];
    };
  };
}

/** Docks the plane showing pane `id` without animation. */
function dockPane(id: string): unknown {
  const engine = (window as unknown as EngineWindow).__qaEngine;
  const node = engine.tree.get().find((entry) => entry.routeDivisions.plane.parameters.id === id)!;
  return engine.camera.dock(node.planeID, { animate: false });
}

/** The text of the first match; refuses a missing element. */
function requiredText(selector: string): string {
  const element = document.querySelector(selector);
  if (!element) throw new Error('Nothing matches: ' + selector);
  return element.textContent;
}

const unifiedKeepsEdit = () =>
  !document.querySelector('.cm-mergeView') &&
  document.querySelector('.diff-text-editor')?.textContent.includes('Retained diff edit') === true;

export async function verifyMilestones(
  harness: MilestonesHarness,
  context: MilestonesContext,
): Promise<void> {
  const {
    evaluate,
    until,
    click,
    command,
    settleCamera,
    snapshot,
    paletteCommand,
    reloadPage,
    captureEngine,
  } = harness;
  const { files, profile, stateFile, binary, debuggerOrigin, initialRootID } = context;
  const note = path.join(files, 'README.md');
  await until(
    () => evaluate(textOf('.git-branch')),
    (value) => value.includes('main'),
    'Git branch in the folder header',
  );
  const status = await evaluate(
    pageCall((folder: string) => window.viewer.git({ kind: 'status', path: folder }), files),
  );
  assert.equal(status.kind, 'ready');
  assert.ok(
    status.snapshot?.changes.some(
      (change) => change.path === 'README.md' && change.status === 'modified',
    ),
  );
  await click('.git-branch');
  await until(() => evaluate(exists('.git-review-file')), Boolean, 'Git changes plane');
  await settleCamera();
  await click('.git-review-file');
  await until(
    () => evaluate(buttonState('Open diff', '.git-review')),
    (state) => state === 'enabled',
    'selected change',
  );
  await evaluate(pressButton('Open diff', '.git-review'));
  await until(
    () => evaluate(exists('.cm-merge-b .cm-content')),
    Boolean,
    'editable working file comparison',
  );
  await settleCamera();
  await snapshot('desktop-native-git-diff.png');
  const before = await evaluate(pageCall(requiredText, '.cm-merge-b .cm-content'));
  assert.ok(before.includes('Working version'));
  await click('.cm-merge-b .cm-content');
  await command('Input.insertText', { text: 'Retained diff edit ' });
  await until(
    () => evaluate(textOf('.cm-merge-b .cm-content')),
    (value) => value.includes('Retained diff edit'),
    'right comparison side accepts edits',
  );
  await click('.diff-plane:has(.diff-text-editor) button[aria-label="Comparison mode"]');
  await click('.choice-menu [data-menu-id="choice:unified"]');
  await until(
    () => evaluate(pageCall(unifiedKeepsEdit)),
    Boolean,
    'unified mode preserves right-side edits',
  );
  assert.equal(
    await readFile(note, 'utf8'),
    '# Working version\n\nA changed file for comparison.\n',
  );
  await snapshot('desktop-native-unified-diff.png');
  const rootID = initialRootID;
  await evaluate(pageCall(dockPane, rootID));
  await settleCamera();
  await click(`[data-viewer-plane="${rootID}"] .plane-heading`);
  await paletteCommand('Chat about files');
  await until(() => evaluate(exists('textarea[aria-label="Chat message"]')), Boolean, 'Chat plane');
  await settleCamera();
  await click('textarea[aria-label="Chat message"]');
  await command('Input.insertText', { text: 'Draft kept across reloads' });
  await until(
    async () => {
      const names = await readdir(path.join(profile, 'chat-documents')).catch(() => [] as string[]);
      if (!names[0]) return '';
      return JSON.parse(await readFile(path.join(profile, 'chat-documents', names[0]), 'utf8'))
        .draft as string;
    },
    (draft) => draft === 'Draft kept across reloads',
    'durable Chat draft',
  );
  await snapshot('desktop-native-chat.png');
  await reloadPage();
  await captureEngine();
  await until(
    () => evaluate(valueOf('textarea[aria-label="Chat message"]')),
    (value) => value === 'Draft kept across reloads',
    'Chat draft recovered after reload',
  );
  await evaluate(pageCall(dockPane, 'milestone-image'));
  await settleCamera();
  const imagePlane = '.pane-marker[data-viewer-pane="milestone-image"]';
  await until(
    () => evaluate(exists(imagePlane + ' [aria-label="Comparison divider"]')),
    Boolean,
    'image slider comparison',
  );
  for (const mode of ['onion', 'side', 'difference']) {
    await click(`${imagePlane} button[aria-label="Comparison mode"]`);
    await click(`.choice-menu [data-menu-id="choice:${mode}"]`);
    if (mode === 'onion')
      await until(
        () => evaluate(exists(imagePlane + ' [aria-label="Right image opacity"]')),
        Boolean,
        'onion skin control',
      );
    if (mode === 'side')
      assert.equal(await evaluate(countOf(imagePlane + ' .image-diff-pair img')), 2);
    if (mode === 'difference')
      await until(
        () =>
          evaluate(
            pageCall(
              (selector: string) => document.querySelector<HTMLCanvasElement>(selector)?.width ?? 0,
              imagePlane + ' .image-difference',
            ),
          ),
        (width) => width === 128,
        'bounded pixel difference worker',
      );
  }
  await snapshot('desktop-native-image-difference.png');
  await execNative(binary, ['--new-window'], {
    env: {
      ...process.env,
      VIEWER_DATA_DIRECTORY: profile,
      VIEWER_RENDER_TEST: '1',
      VIEWER_BACKGROUND_TEST: '1',
    },
    timeout: 10000,
  });
  await until(
    async () =>
      ((await (await fetch(`${debuggerOrigin}/json/list`)).json()) as { url: string }[]).filter(
        (target) =>
          target.url.startsWith('viewer-app://app/index.html') &&
          !target.url.includes('window=settings'),
      ).length,
    (count) => count === 2,
    'two independent native windows',
  );
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) => (state.openWindows?.length ?? 0) === 2 && new Set(state.openWindows).size === 2,
    'independent workspace owners persisted',
  );
  console.log(
    'Milestones: hardened Git status, editable HEAD diff, unified mode retention, durable Chat drafts, and independent native windows.',
  );
}
