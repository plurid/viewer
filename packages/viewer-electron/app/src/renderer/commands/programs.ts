import { effectiveWindowSettings } from '../state/effective-ui';
import { plainCommandID } from '../../domain/command-line/verbs';
import { withArguments } from '../../domain/command-line/lex';
import type { CommandContext, CommandDefinition } from './registry';
import { actionAvailable, terminalDirectory } from '../../domain/automation/actions';
import { activeWorkspace, getState } from '../state/store';
import { newPlaneFolder } from '../../domain/services';
import type { WorkspaceController } from '../workspace/context';
import { requestAction } from '../actions/commands';
import type { IconName } from '../ui/Icon';
import { captureTarget } from './target';
import { localServerCommands } from '../local-servers/commands';
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
export { captureTarget } from './target';
export interface ProgramTools {
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
  /** A step with words (`vs ~/Documents`, 2026-10-23), run by the command line. */
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
    ...localServerCommands(workspace, showServers),
    ...exportPresetCatalog.map((preset): CommandDefinition => ({
      id: preset.id,
      label: preset.name,
      group: 'Export',
      icon: preset.kind === 'image' ? 'image' : preset.kind === 'pdf' ? 'pdf' : 'audio',
      aliases: [preset.description, 'export preset'],
      when: (context) =>
        exportPresetAvailable(preset, context.selection) &&
        (preset.kind === 'image' ? !!imageTools : preset.kind === 'pdf' ? !!optimizeFiles : true),
      run: (context) => {
        const files = structuredClone([...context.selection]);
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
      when: (context) =>
        !!pdfTools &&
        context.selection.length > 0 &&
        context.selection.length <= 16 &&
        context.selection.every(
          (file) => file.kind === 'file' && file.extension.toLowerCase() === 'pdf',
        ),
      run: (context) => pdfTools?.(structuredClone([...context.selection]), context.paneID),
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
      when: (context) =>
        !!optimizeFiles &&
        context.selection.length > 0 &&
        context.selection.length <= 1000 &&
        context.selection.every(optimizable),
      run: (context) => optimizeFiles?.(structuredClone([...context.selection]), context.paneID),
    },
    {
      id: 'edit-media',
      label: 'Edit media…',
      group: 'Files',
      icon: 'video',
      aliases: ['trim', 'join clips', 'extract audio', 'mute video', 'mix audio', 'media editor'],
      when: (context) =>
        context.selection.length > 0 &&
        context.selection.length <= 16 &&
        context.selection.every(
          (file) =>
            file.kind === 'file' &&
            (mediaFormats as readonly string[]).includes(file.extension.toLowerCase()),
        ),
      run: (context) =>
        workspace.openMedia(
          context.selection.map((file) => file.path),
          context.paneID,
        ),
    },
    {
      id: 'image-tools',
      label: 'Convert images…',
      group: 'Images',
      icon: 'image',
      aliases: ['webp', 'avif', 'resize', 'crop', 'image tools', 'quality'],
      when: (context) =>
        !!imageTools &&
        context.selection.length > 0 &&
        context.selection.length <= 1000 &&
        context.selection.every((file) => file.kind === 'file' && transformableImage(file)),
      run: (context) => imageTools?.(structuredClone([...context.selection]), context.paneID),
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
      // a root plane of its own, from anywhere (2026-10-23): Open terminal plane links one to a folder
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
        icon: (['terminal', 'command', 'rename', 'folder', 'external', 'code', 'copy'].includes(
          action.icon,
        )
          ? action.icon
          : 'command') as IconName,
        aliases: action.aliases,
        shortcut: action.shortcut,
        primary: action.pinned,
        // a sequence runs anywhere a command can; the others act on a folder's selection
        when: (context) =>
          action.executor.kind === 'sequence' && !folder(context)
            ? true
            : folder(context) && actionAvailable(action, captureTarget(context, workspace)),
        run: async (context) => {
          const executor = action.executor;
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
            // an unknown or unavailable command did nothing, silently (2026-10-20)
            if ((await invoke(executor.command, context)) === false)
              throw new Error(
                `“${action.name}” runs “${executor.command}”, which is not a command available here.`,
              );
          } else if (executor.kind === 'recipe') {
            // it opened Run action with no recipe, whose Create did nothing (2026-10-20)
            if (!getState().settings.settings.recipes.some(({ id }) => id === executor.recipeID))
              throw new Error(
                `The recipe of “${action.name}” no longer exists. Choose another in Settings → Actions.`,
              );
            requestAction(executor.recipeID, context);
          } else if (executor.kind === 'terminal')
            workspace.newTerminal(target(context), executor.profileID);
          else await window.viewer.customExecute(action.id, captureTarget(context, workspace));
        },
      })),
  ];
}
