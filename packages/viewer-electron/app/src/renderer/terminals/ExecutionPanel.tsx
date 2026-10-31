import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ExecutionTask } from '../../domain/automation/actions';
import { report } from '../state/store';
import { followSnapshot } from '../state/requests';
import type { DesktopEvent } from '../../domain/contracts';
import { Panel, PanelSection } from '../ui/Panel';
import { Button, CopyButton, PathField } from '../ui/primitives';
import { useWorkspace } from '../workspace/context';
import { useWindowEvent } from '../app/window-events';
import { observeQuickCommands, quickCommandSnapshot, subscribeQuickCommand } from './quick-command';
export function ExecutionPanel() {
  const workspace = useWorkspace();
  const quick = useSyncExternalStore(subscribeQuickCommand, quickCommandSnapshot);
  const [tasks, setTasks] = useState<ExecutionTask[]>([]);
  useEffect(() => observeQuickCommands(tasks), [tasks]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useWindowEvent('viewer:command-progress', () => {
    setDismissed(false);
    setExpanded(true);
  });
  const running = tasks.filter((task) => task.status === 'running').length;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    const following = followSnapshot<ExecutionTask[], DesktopEvent>({
      load: () => window.viewer.executionList(),
      subscribe: (listener) => window.viewer.onEvent(listener),
      apply: (tasks, event) => {
        if (event.type !== 'execution') return tasks;
        return tasks.some((task) => task.id === event.task.id)
          ? tasks.map((task) => (task.id === event.task.id ? event.task : task))
          : [...tasks, event.task].slice(-20);
      },
      set: setTasks,
      failed: report,
    });
    const unsubscribe = window.viewer.onEvent((event) => {
      if (event.type === 'execution') setDismissed(false);
    });
    return () => {
      following.stop();
      unsubscribe();
    };
  }, []);
  if (!tasks.length || dismissed || quick.visible) return null;
  return (
    <Panel
      className="execution-panel"
      label="Command progress"
      title={
        running
          ? `${running} command${running === 1 ? '' : 's'} running`
          : tasks.at(-1)!.title + ': ' + tasks.at(-1)!.status
      }
      collapsed={!expanded}
      onCollapsedChange={(collapsed) => setExpanded(!collapsed)}
      onClose={() => setDismissed(true)}
      closeLabel="Hide command progress"
    >
      {expanded &&
        tasks.map((task) => (
          <PanelSection
            key={task.id}
            title={task.title}
            meta={
              <>
                {task.status}
                {task.exitCode !== undefined ? ` · exit ${task.exitCode}` : ''}
                {task.started !== undefined
                  ? ` · ${Math.max(0, Math.round(((task.ended ?? now) - task.started) / 1000))}s`
                  : ''}
              </>
            }
          >
            {task.status === 'running' && (
              <Button
                variant="secondary"
                onClick={() => {
                  void window.viewer.executionCancel(task.id).catch(report);
                }}
              >
                Stop
              </Button>
            )}
            {task.error && <p role="alert">{task.error}</p>}
            {task.directory && <PathField className="muted" path={task.directory} />}
            {task.truncated && <p role="status">Showing the last 256 KiB of output.</p>}
            {task.command && (
              <button onClick={() => workspace.openReceipt(task.id, task.directory)}>
                Open receipt
              </button>
            )}
            {!!task.output && (
              <CopyButton appearance="text" label="Copy output" copy={{ text: task.output }} />
            )}
            {task.output && <pre>{task.output}</pre>}
          </PanelSection>
        ))}
    </Panel>
  );
}
