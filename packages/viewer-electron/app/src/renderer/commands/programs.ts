import { effectiveWindowSettings } from '../state/effective-ui';
import { plainCommandID } from '../../domain/command-line/verbs';
import { withArguments } from '../../domain/command-line/lex';
import type { CommandContext, CommandDefinition } from './registry';
import { actionAvailable, actionInputs, terminalDirectory } from '../../domain/automation/actions';
import { requestParameters } from './ActionParameters';
import { executeAction } from './execute-action';
import { activeWorkspace, getState } from '../state/store';
import { newPlaneFolder } from '../../domain/services';
import type { WorkspaceController } from '../workspace/context';
import { requestAction } from '../actions/commands';
import type { IconName } from '../ui/Icon';
import { captureTarget, toolFiles } from './target';
import { localServerCommands } from '../local-servers/commands';
import { layoutCommands } from '../layout/commands';
import { checkCommands, checkResultCommands } from '../fabrication/commands';
import { mediaFormats } from '../../domain/operations/transforms';
import { transformableImage } from '../../domain/operations/image-conversions';
import { optimizable } from '../../domain/operations/optimization';
import type { FileEntry } from '../../domain/contracts';
import {
  exportPresetCatalog,
  exportPresetAvailable,
  type ImageExportPreset,
  type PDFExportPreset,
} from '../../domain/operations/export-presets';
import { sendWindowEvent } from '../app/window-events';
export { captureTarget } from './target';
export interface ProgramTools {
  showTasks?(target?: ReturnType<typeof captureTarget>): void;
  branchTask?(target: ReturnType<typeof captureTarget>): void;
  showNotes?(): void;
  showAgentSessions?(directory?: string): void;
  runCommand?(target: ReturnType<typeof captureTarget>): void;
  showServers?(): void;
  newBrowser?(paneID?: string): void;
  imageTools?(files: FileEntry[], paneID?: string, preset?: ImageExportPreset): void;
  optimizeFiles?(files: FileEntry[], paneID?: string, preset?: PDFExportPreset): void;
  pdfTools?(files: FileEntry[], paneID?: string): void;
}
export function programCommands(
  workspace: WorkspaceController,
  /** `false` when no command of that ID is available here. */
  invoke: (id: string, context: CommandContext) => Promise<boolean | void>,
  terminalName?: string,
  /** The context as it is now: a sequence's later steps act where the earlier ones left it. */
  live?: () => CommandContext,
  /** A step with words (`vs ~/Documents`), run by the command line. */
  line?: (text: string) => Promise<{ ok: boolean; message?: string }>,
  tools: ProgramTools = {},
): CommandDefinition[] {
  const { showServers, newBrowser, imageTools, optimizeFiles, pdfTools } = tools;
  const folder = (context: CommandContext) => !!context.directory || !!context.folder;
  const target = (context: CommandContext) => {
    const captured = captureTarget(context, workspace);
    return { ...captured, directory: terminalDirectory(captured.directory, captured.selection) };
  };
  return [
    {
      id: 'agent-sessions',
      label: 'Agent sessions…',
      group: 'Workspace',
      icon: 'command',
      aliases: ['agent conversations', 'codex sessions', 'claude sessions'],
      when: () => !!tools.showAgentSessions,
      run: (context) => tools.showAgentSessions?.(context.directory),
    },
    {
      id: 'new-task-from-branch',
      label: 'New task from branch…',
      group: 'Workspace',
      icon: 'folder',
      aliases: ['branch task', 'task worktree', 'new development task'],
      when: (context) => !!tools.branchTask && !!context.folder && folder(context),
      run: (context) => tools.branchTask?.(target(context)),
    },
    {
      id: 'open-tasks',
      label: 'Tasks…',
      group: 'Workspace',
      icon: 'tasks',
      aliases: ['task areas', 'task context', 'command history'],
      when: () => !!tools.showTasks,
      run: () => tools.showTasks?.(),
    },
    {
      id: 'new-task-area',
      label: 'New task area…',
      group: 'Workspace',
      icon: 'tasks',
      aliases: ['task', 'branch workspace', 'task context'],
      when: (context) => !!tools.showTasks && !!context.folder && folder(context),
      run: (context) => tools.showTasks?.(target(context)),
    },
    ...(['note', 'checklist'] as const).map((kind): CommandDefinition => ({
      id: 'new-' + kind + '-plane',
      label: kind === 'note' ? 'New note plane' : 'New checklist plane',
      group: 'Text',
      icon: kind === 'note' ? 'text' : 'check',
      aliases: [kind, 'markdown'],
      when: () => activeWorkspace().panes.length < 200,
      run: (context) => workspace.newNote(kind, context.directory, context.paneID),
    })),
    {
      id: 'open-notes',
      label: 'Notes…',
      group: 'Text',
      icon: 'text',
      aliases: ['saved notes', 'checklists', 'reopen note'],
      when: () => !!tools.showNotes,
      run: () => tools.showNotes?.(),
    },
    ...localServerCommands(workspace, showServers),
    ...exportPresetCatalog.map((preset): CommandDefinition => ({
      id: preset.id,
      label: preset.name,
      group: 'Export',
      icon: preset.kind === 'image' ? 'image' : preset.kind === 'pdf' ? 'pdf' : 'audio',
      aliases: [preset.description, 'export preset'],
      when: (context) =>
        exportPresetAvailable(preset, toolFiles(context)) &&
        (preset.kind === 'image' ? !!imageTools : preset.kind === 'pdf' ? !!optimizeFiles : true),
      run: (context) => {
        const files = structuredClone(toolFiles(context));
        if (preset.kind === 'image') return imageTools?.(files, context.paneID, preset.preset);
        if (preset.kind === 'pdf') return optimizeFiles?.(files, context.paneID, preset.preset);
        return workspace.openMedia(
          files.map((file) => file.path),
          context.paneID,
          true,
          'extract-audio',
        );
      },
    })),
    {
      id: 'pdf-tools',
      label: 'PDF tools…',
      group: 'Files',
      icon: 'file',
      aliases: ['merge pdf', 'split pdf', 'extract pages', 'rotate pages', 'reorder pages'],
      when: (context) => {
        const files = toolFiles(context);
        return (
          !!pdfTools &&
          files.length > 0 &&
          files.length <= 16 &&
          files.every((file) => file.kind === 'file' && file.extension.toLowerCase() === 'pdf')
        );
      },
      run: (context) => pdfTools?.(structuredClone(toolFiles(context)), context.paneID),
    },
    {
      id: 'optimize-files',
      label: 'Optimize…',
      group: 'Files',
      icon: 'archive',
      primary: true,
      aliases: [
        'minify',
        'reduce file size',
        'compress pdf',
        'optimize images',
        'minimize',
        'shrink',
      ],
      when: (context) => {
        const files = toolFiles(context);
        return (
          !!optimizeFiles && files.length > 0 && files.length <= 1000 && files.every(optimizable)
        );
      },
      run: (context) => optimizeFiles?.(structuredClone(toolFiles(context)), context.paneID),
    },
    {
      id: 'edit-media',
      label: 'Edit media…',
      group: 'Files',
      icon: 'video',
      aliases: ['trim', 'join clips', 'extract audio', 'mute video', 'mix audio', 'media editor'],
      when: (context) => {
        const files = toolFiles(context);
        return (
          files.length > 0 &&
          files.length <= 16 &&
          files.every(
            (file) =>
              file.kind === 'file' &&
              (mediaFormats as readonly string[]).includes(file.extension.toLowerCase()),
          )
        );
      },
      run: (context) =>
        workspace.openMedia(
          toolFiles(context).map((file) => file.path),
          context.paneID,
        ),
    },
    ...layoutCommands(workspace),
    ...checkCommands(),
    ...checkResultCommands(workspace),
    {
      id: 'image-tools',
      label: 'Convert images…',
      group: 'Images',
      icon: 'image',
      aliases: ['webp', 'avif', 'resize', 'crop', 'image tools', 'quality'],
      when: (context) => {
        const files = toolFiles(context);
        return (
          !!imageTools &&
          files.length > 0 &&
          files.length <= 1000 &&
          files.every((file) => file.kind === 'file' && transformableImage(file))
        );
      },
      run: (context) => imageTools?.(structuredClone(toolFiles(context)), context.paneID),
    },
    {
      id: 'open-browser-plane',
      label: 'Open web page…',
      group: 'Workspace',
      icon: 'external',
      aliases: ['browser', 'website', 'url', 'web page'],
      when: () => !!newBrowser,
      run: (context) => newBrowser?.(context.paneID),
    },
    {
      id: 'command-progress',
      label: 'Command progress',
      group: 'Terminal',
      icon: 'list',
      aliases: ['running commands', 'command output', 'background commands'],
      when: () => true,
      run: () => {
        sendWindowEvent('viewer:command-progress');
      },
    },
    {
      id: 'run-command',
      label: 'Run command…',
      group: 'Terminal',
      icon: 'command',
      aliases: ['shell command', 'run in folder', 'execute', 'git init'],
      when: (context) => folder(context) && !!context.folder && !!tools.runCommand,
      run: (context) => tools.runCommand?.({ ...target(context), selection: [] }),
    },
    {
      id: 'open-terminal',
      label: terminalName ? 'Open in ' + terminalName : 'Open Terminal',
      group: 'Terminal',
      icon: 'terminal',
      aliases: ['ot', 'terminal', 'iterm', 'shell'],
      when: folder,
      run: (context) => window.viewer.terminalExternal(target(context).directory, false),
    },
    {
      id: 'open-tmux',
      label: 'Open in tmux',
      group: 'Terminal',
      icon: 'terminal',
      aliases: ['tm', 'tmux', 'window'],
      when: folder,
      run: (context) => window.viewer.terminalExternal(target(context).directory, true),
    },
    {
      id: 'open-terminal-plane',
      label: 'Open terminal plane',
      group: 'Terminal',
      icon: 'terminal',
      primary: true,
      aliases: ['tp', 'terminal plane', 'shell plane'],
      when: folder,
      run: (context) => workspace.newTerminal(target(context)),
    },
    {
      id: 'new-terminal-plane',
      label: 'New terminal plane',
      group: 'Terminal',
      icon: 'terminal',
      aliases: ['nt', 'root terminal', 'new terminal', 'terminal', 'shell'],
      // a root plane of its own, from anywhere: Open terminal plane links one to a folder
      when: () => true,
      run: (context) => {
        const space = activeWorkspace();
        const owner = space.panes.find(
          (pane) => pane.id === (context.paneID || getState().activePane),
        );
        const current =
          context.directory ||
          context.folder?.path ||
          (owner?.type === 'folder' || owner?.type === 'terminal' ? owner.path : undefined);
        workspace.newTerminal({
          workspaceID: context.workspaceID || space.id,
          rootID: '',
          paneID: '',
          // where new planes start: Settings → Browsing
          directory: newPlaneFolder(
            effectiveWindowSettings(getState()).browsing,
            getState().bootstrap.home,
            current,
            space.panes.length === 0,
          ),
          selection: [],
        });
      },
    },
    {
      id: 'open-config',
      label: 'Open configuration file',
      group: 'App',
      icon: 'settings',
      aliases: ['config', 'jsonc', 'oc'],
      when: () => true,
      run: () => window.viewer.configOpen(),
    },
    ...getState()
      .settings.settings.customActions.toSorted((a, b) => a.order - b.order)
      .map((action): CommandDefinition => ({
        id: 'custom.' + action.id,
        label: action.name,
        group: 'Actions',
        paletteFolder: action.folder,
        icon: (['terminal', 'command', 'rename', 'folder', 'external', 'code', 'copy'].includes(
          action.icon,
        )
          ? action.icon
          : 'command') as IconName,
        aliases: [...action.aliases, ...(action.folder ?? [])],
        shortcut: action.shortcut,
        primary: action.pinned,
        // a sequence runs anywhere a command can; the others act on a folder's selection
        when: (context) =>
          action.executor.kind === 'sequence' &&
          !folder(context) &&
          !action.when.directories?.length
            ? true
            : folder(context) && actionAvailable(action, captureTarget(context, workspace)),
        run: async (context) => {
          const executor = action.executor;
          if (executor.kind === 'workflow') {
            const actions = structuredClone(getState().settings.settings.customActions);
            const captured = captureTarget(context, workspace);
            const values = await requestParameters(action.name, actionInputs(action, actions));
            if (!values) return;
            for (const [index, step] of executor.steps.entries()) {
              if (activeWorkspace().id !== captured.workspaceID)
                throw new Error('The workspace changed. The workflow stopped.');
              if (
                !activeWorkspace().panes.some(
                  (pane) => pane.id === captured.paneID && pane.path === captured.panePath,
                )
              )
                throw new Error('The originating plane changed. The workflow stopped.');
              try {
                if (step.kind === 'action') {
                  const child = actions.find((action) => action.id === step.actionID);
                  if (
                    !child ||
                    !['shell', 'executable'].includes(child.executor.kind) ||
                    !actionAvailable(child, captured)
                  )
                    throw new Error('The command is unavailable in the captured folder.');
                  await executeAction(child, captured, values);
                } else {
                  const result = line
                    ? await line(step.line)
                    : { ok: false, message: 'Command line unavailable.' };
                  if (!result.ok) throw new Error(result.message || 'Command did not finish.');
                }
              } catch (error) {
                throw new Error(
                  `${action.name} stopped at step ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
            return;
          }
          if (executor.kind === 'sequence') {
            for (const [index, command] of executor.commands.entries()) {
              if (command.startsWith('custom.'))
                throw new Error('Custom actions cannot call another custom action.');
              if (!plainCommandID(command)) {
                // run from a menu or a key, a named sequence has no words: $1… are empty
                const text = withArguments(command, [], executor.command ?? action.name);
                const result = line ? await line(text) : { ok: false };
                if (!result.ok)
                  throw new Error(
                    `“${action.name}” stopped at “${command}”${result.message ? `: ${result.message}` : '.'}`,
                  );
                continue;
              }
              const step = index ? (live?.() ?? context) : context;
              if ((await invoke(command, step)) === false)
                throw new Error(
                  `“${action.name}” stopped at “${command}”, which is not a command available here.`,
                );
            }
            return;
          }
          if (executor.kind === 'builtin') {
            if (executor.command.startsWith('custom.'))
              throw new Error('Custom actions cannot call another custom action.');
            // an unknown or unavailable command did nothing, silently
            if ((await invoke(executor.command, context)) === false)
              throw new Error(
                `“${action.name}” runs “${executor.command}”, which is not a command available here.`,
              );
          } else if (executor.kind === 'recipe') {
            // it opened Run action with no recipe, whose Create did nothing
            if (!getState().settings.settings.recipes.some(({ id }) => id === executor.recipeID))
              throw new Error(
                `The recipe of “${action.name}” no longer exists. Choose another in Settings → Actions.`,
              );
            requestAction(executor.recipeID, context);
          } else if (executor.kind === 'terminal')
            workspace.newTerminal(target(context), executor.profileID);
          else {
            const captured = captureTarget(context, workspace);
            const values = await requestParameters(action.name, actionInputs(action, []));
            if (values) await executeAction(action, captured, values);
          }
        },
      })),
  ];
}
