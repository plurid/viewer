import { pageCall } from '../../../tests/native/runtime/page-function';
import { branchSample, sampleFolders } from '../samples';
import type { ReviewArea } from '../types';
import { coverageVariants } from '../variants';

const setup = { folder: branchSample };
export const runtimeScenes: ReviewArea = {
  id: 'runtime-recovery',
  title: 'Canvases, tasks and runtimes',
  scenes: [
    {
      id: 'canvas-stopped-reconstruction',
      title: 'Stopped canvas and Photo to 3D',
      setup,
      variants: coverageVariants,
      focus: ['.canvas-plane'],
      mustBeTrue: [
        'Reload is reachable after Stop. Empty photo and model choices explain what is missing.',
      ],
      async steps(page) {
        await page.palette('Chat About Files');
        await page.button('Canvas', '.chat-toolbar');
        await page.waitFor('.canvas-plane iframe');
        await page.button('Stop', '.canvas-toolbar');
        await page.button('Reload', '.canvas-body');
        await page.waitFor('.canvas-plane iframe');
        await page.button('Stop', '.canvas-toolbar');
        await page.button('Tools', '.canvas-toolbar');
        await page.button('Photo to 3D', '.choice-menu');
        await page.waitFor('.reconstruction-panel .choice-button:disabled', 2);
        await page.expectNone('.canvas-body[inert]', 'Stopped canvas controls accept input.');
      },
    },
    {
      id: 'branch-task-form',
      title: 'Branch task fields and actions',
      setup,
      variants: coverageVariants,
      focus: ['.worktrees-dialog'],
      mustBeTrue: [
        'The fields scroll at the narrow window size. Cancel and Create Task remain fully visible.',
      ],
      async steps(page) {
        await page.palette('New Task from Branch…');
        await page.type('[aria-label="Branch task name"]', 'Compare colors');
        await page.type('[aria-label="New branch name"]', 'review/colors');
        await page.scrollIntoView('[aria-label="Worktree destination"]');
        await page.expectInsideWindow(
          '.worktree-create footer',
          0,
          'The form actions remain within the window.',
        );
      },
    },
    {
      id: 'branch-task-overview',
      title: 'Task tools in an existing checkout',
      setup,
      variants: coverageVariants,
      focus: ['.task-tool-row'],
      mustBeTrue: [
        'Checkout and tool paths keep their folder names. The terminal and Git views wait for a start.',
      ],
      async steps(page) {
        await page.palette('New Task from Branch…');
        await page.type('[aria-label="Branch task name"]', 'Compare colors');
        await page.button('Existing Branch', '.worktree-create');
        await page.button('Use Checkout for Task', '.worktree-create');
        await page.waitFor('.task-tool-row .path-label', 4);
      },
    },
    {
      id: 'svg-source-comparison',
      title: 'Compare SVG source',
      setup,
      variants: coverageVariants,
      focus: ['.diff-plane'],
      mustBeTrue: ['Both SVG sources and change navigation are readable.'],
      async steps(page) {
        await page.select(page.path(branchSample, 'red.svg'));
        await page.addToSelection(page.path(branchSample, 'blue.svg'));
        await page.palette('Compare Files');
        await page.waitFor('.diff-plane .cm-editor');
        await page.expectText('Next Change', 'SVG source offers change navigation.');
      },
    },
    {
      id: 'browser-linked-server',
      title: 'Restart the browser’s linked local server',
      setup,
      variants: coverageVariants,
      focus: ['.browser-plane'],
      mustBeTrue: [
        'Stopping the sample server reveals Start Server. Restarting it keeps the browser linked to the same folder.',
      ],
      async steps(page) {
        await page.palette('Start Local Server');
        await page.button('Open in Viewer', '.server-plane');
        await page.waitFor('.browser-plane');
        await page.evaluate(
          pageCall(async (root: string) => {
            const server = (await window.viewer.localServers()).find((item) => item.root === root);
            if (!server) throw new Error('The sample folder has no local server.');
            await window.viewer.localServerAction(server.id, 'stop');
          }, page.path(branchSample)),
        );
        await page.waitFor('.browser-error[role="status"]');
        await page.button('Start Server', '.browser-plane');
        await page.gone('.browser-error[role="status"]');
      },
    },
    {
      id: 'browser-page-limit',
      title: 'Retry a browser page after reaching the limit',
      setup,
      variants: coverageVariants,
      focus: ['.browser-plane'],
      mustBeTrue: [
        'The page-limit message stays visible. Try Again opens the page after a slot is freed.',
      ],
      async steps(page) {
        await page.palette('Start Local Server');
        await page.waitFor('.server-state[data-state="running"]');
        const address = await page.evaluate(
          pageCall(async (root: string) => {
            const server = (await window.viewer.localServers()).find(
              (item) => item.root === root && item.state === 'running',
            );
            if (!server) throw new Error('The sample folder has no running server.');
            for (let i = 0; i < 8; i++)
              await window.viewer.browser({
                kind: 'open',
                id: 'review-slot-' + i,
                url: server.url,
                width: 160,
                height: 160,
              });
            return server.url;
          }, page.path(branchSample)),
        );
        await page.palette('Open Web Page…');
        await page.type('dialog[open] input', address);
        await page.button('Open', 'dialog[open]');
        await page.waitFor('.browser-error[role="alert"]');
        await page.expectText(
          'Close a browser plane before opening another.',
          'The original page-limit message is visible.',
        );
        page.afterCapture.push(async () => {
          await page.evaluate(
            pageCall(() => window.viewer.browser({ kind: 'close', id: 'review-slot-0' })),
          );
          await page.button('Try Again', '.browser-plane');
          await page.gone('.browser-error[role="alert"]');
          await page.waitFor('.browser-status button:first-of-type:not(:disabled)');
        });
      },
    },
    {
      id: 'terminal-definition-approval',
      title: 'Definition terminal awaiting approval',
      setup: { folder: sampleFolders.samples },
      blocked: 'The native terminal approval requires a person in a visible window.',
      mustBeTrue: [
        'Choose Run for a workspace definition command. The terminal shows Waiting for terminal approval until the person approves or cancels.',
      ],
      async steps() {},
    },
  ],
};
