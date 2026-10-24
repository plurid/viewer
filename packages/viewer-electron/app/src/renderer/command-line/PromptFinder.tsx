import { useEffect, useMemo, useRef, useState } from 'react';
import { LineError } from '../../domain/command-line/lex';
import type { PromptAnswer, PromptContext } from '../../domain/command-line/prompt';
import { modelPermissionCovers } from '../../domain/models/permissions';
import { CommandResults } from '../commands/CommandResults';
import type { ResolvedCommand } from '../commands/registry';
import { activeWorkspace, getState, rememberLine, useViewer } from '../state/store';
import { IconButton } from '../ui/primitives';
import type { IconName } from '../ui/Icon';
import { useModelPermission } from '../ui/models/ModelDataPermission';
import type { LineHost } from './host';
import { planLine, userCommands } from './run';

const examples = [
  'sort by date modified, newest first',
  'select the images',
  'show only the PDFs from this week',
  'put Documents beside this folder',
  'hide the minimap and the grid',
];
interface Row {
  id: string;
  label: string;
  detail?: string;
  icon: IconName;
  run(): void;
}
/** Where the request was typed, as the model may be told (names, no contents). */
function promptContext(host: LineHost): PromptContext {
  const context = host.context();
  const folder = context.folder?.path ?? context.directory;
  return {
    ...(folder ? { folder } : {}),
    selection: context.selection.slice(0, 50).map((entry) => entry.name.slice(0, 255)),
    workspace: activeWorkspace().name,
    workspaces: getState().saved.workspaces.map((space) => space.name),
    commands: host.registry
      .list({ scope: 'window', paneID: context.paneID, context })
      .filter((command) => !command.id.includes(':') && !command.id.startsWith('setting.'))
      .slice(0, 600)
      .map((command) => ({ id: command.id, label: command.label.slice(0, 200) })),
    userCommands: [...userCommands().keys()],
  };
}
/**
 * A REQUEST IN WORDS (2026-10-24): `>` in the palette asks a model, which answers with one line of
 * the command language and a sentence. The line is the person's to read: Enter runs it, Tab opens
 * it in the command line to change. The model is told the commands here, the folder's path and
 * the selected names, as its provider's "names" permission allows.
 */
export function PromptFinder({
  host,
  initialQuery,
  onRun,
  onEdit,
  onBack,
  onChat,
}: {
  host: LineHost;
  initialQuery: string;
  onRun(line: string): void;
  onEdit(line: string): void;
  onBack(): void;
  onChat(text: string): void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'asking'; id: string }
    | { kind: 'answer'; asked: string; answer: PromptAnswer }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const settings = useViewer((current) => current.settings.settings);
  const provider = useMemo(
    () =>
      settings.providers.find((item) => item.id === settings.prompts.providerID) ??
      settings.providers[0],
    [settings.providers, settings.prompts.providerID],
  );
  const permission = useModelPermission(provider);
  const allowed = !!provider && modelPermissionCovers(permission.permission, provider, 'names');
  const asking = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      if (asking.current) void window.viewer.promptCancel(asking.current).catch(() => {});
    },
    [],
  );
  const ask = async () => {
    const prompt = query.trim();
    if (!prompt || !provider || !allowed) return;
    const id = crypto.randomUUID();
    asking.current = id;
    setState({ kind: 'asking', id });
    try {
      const answer = await window.viewer.promptLine({ id, prompt, context: promptContext(host) });
      if (asking.current === id) setState({ kind: 'answer', asked: prompt, answer });
    } catch (error) {
      if (asking.current === id) setState({ kind: 'failed', message: (error as Error).message });
    } finally {
      if (asking.current === id) asking.current = undefined;
    }
  };
  const run = (line: string) => {
    try {
      planLine(line, host);
    } catch (error) {
      if (error instanceof LineError) {
        setState({ kind: 'failed', message: error.message });
        return;
      }
      throw error;
    }
    rememberLine(line);
    onRun(line);
  };
  const rows: Row[] = !provider
    ? [
        {
          id: 'add-model',
          label: 'Add a model to ask in words',
          detail: 'Settings → Models',
          icon: 'settings',
          run: () => void window.viewer.openSettings('settings.providers').catch(() => {}),
        },
      ]
    : !allowed && !permission.loading
      ? [
          {
            id: 'allow',
            label: `Let ${provider.name} receive file names`,
            detail: `${provider.endpoint}: the request, this folder's path and the selected names; never contents`,
            icon: 'check',
            run: () =>
              void window.viewer
                .providerPermissionSet(provider.id, provider.endpoint, 'names')
                .catch((error: Error) => setState({ kind: 'failed', message: error.message })),
          },
        ]
      : state.kind === 'asking'
        ? [
            {
              id: 'asking',
              label: 'Thinking…',
              detail: provider.name,
              icon: 'clock',
              run: () => {},
            },
          ]
        : state.kind === 'answer' && state.asked === query.trim()
          ? state.answer.line
            ? [
                {
                  id: 'run',
                  label: state.answer.line,
                  detail: state.answer.problem ?? state.answer.explanation,
                  icon: state.answer.problem ? 'warning' : 'right',
                  run: () => {
                    if (!state.answer.problem) run(state.answer.line);
                  },
                },
                {
                  id: 'edit',
                  label: 'Edit in the command line',
                  detail: 'Tab',
                  icon: 'rename',
                  run: () => onEdit(state.answer.line),
                },
              ]
            : [
                {
                  id: 'none',
                  label: state.answer.explanation || 'No line for that.',
                  icon: 'info',
                  run: () => {},
                },
              ]
          : state.kind === 'failed'
            ? [{ id: 'failed', label: state.message, icon: 'warning', run: () => void ask() }]
            : query.trim()
              ? [
                  {
                    id: 'ask',
                    label: `Ask: ${query.trim()}`,
                    detail: provider.name,
                    icon: 'right',
                    run: () => void ask(),
                  },
                ]
              : examples.map((example, index) => ({
                  id: `example:${index}`,
                  label: example,
                  detail: index ? undefined : 'For example',
                  icon: 'info' as const,
                  run: () => setQuery(example),
                }));
  const context = host.context();
  const resolved: ResolvedCommand[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    detail: row.detail,
    icon: row.icon,
    group: 'Prompt',
    aliases: [],
    primary: false,
    source: '',
    context,
  }));
  const answered =
    state.kind === 'answer' && state.asked === query.trim() ? state.answer : undefined;
  return (
    <div className={`line-finder prompt-finder${answered?.line ? ' has-line' : ''}`}>
      <CommandResults
        query={query}
        onQuery={(text) => {
          setQuery(text);
          if (state.kind === 'failed') setState({ kind: 'idle' });
        }}
        rows={resolved}
        onClose={() => {
          if (asking.current) void window.viewer.promptCancel(asking.current).catch(() => {});
          onBack();
        }}
        onEmptyBackspace={onBack}
        label="Ask in words"
        placeholder="Ask Viewer…"
        leading={
          <>
            <IconButton icon="left" label="Back to commands" onClick={onBack} />
            <span className="line-prompt" aria-hidden="true">
              &gt;
            </span>
          </>
        }
        onKey={(event) => {
          if (event.key === 'Tab' && !event.shiftKey && answered?.line) {
            onEdit(answered.line);
            return true;
          }
          return false;
        }}
        onSelect={(chosen) => rows.find((row) => row.id === chosen.id)?.run()}
      />
      <div className="palette-context">
        <span>
          {provider
            ? `${provider.name} · Enter asks, then runs the line · Tab edits it`
            : 'Ask in words with a model from Settings → Models'}
        </span>
        {!!query.trim() && <button onClick={() => onChat(query.trim())}>Continue in Chat</button>}
      </div>
    </div>
  );
}
