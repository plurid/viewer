import { useEffect, useState } from 'react';
import type { ExecutionTask } from '../../domain/automation/actions';
import { report } from '../state/store';
import { IconButton } from '../ui/primitives';
import { useWorkspace } from '../workspace/context';
export function ExecutionPanel() {
  const workspace = useWorkspace();
  const [tasks, setTasks] = useState<ExecutionTask[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const show = () => {
      setDismissed(false);
      setExpanded(true);
    };
    window.addEventListener('viewer:command-progress', show);
    return () => window.removeEventListener('viewer:command-progress', show);
  }, []);
  const running = tasks.filter((task) => task.status === 'running').length;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    void window.viewer.executionList().then(setTasks).catch(report);
    return window.viewer.onEvent((event) => {
      if (event.type === 'execution') {
        setDismissed(false);
        setTasks((tasks) =>
          tasks.some((task) => task.id === event.task.id)
            ? tasks.map((task) => (task.id === event.task.id ? event.task : task))
            : [...tasks, event.task].slice(-20),
        );
      }
    });
  }, []);
  if (!tasks.length || dismissed) return null;
  return (
    <aside className="execution-panel" aria-label="Command progress">
      <div>
        <button onClick={() => setExpanded((value) => !value)}>
          {running
            ? `${running} command${running === 1 ? '' : 's'} running`
            : tasks.at(-1)!.title + ': ' + tasks.at(-1)!.status}
        </button>
        <IconButton icon="close" label="Hide command progress" onClick={() => setDismissed(true)} />
      </div>
      {expanded &&
        tasks.map((task) => (
          <section key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <span>
                {task.status}
                {task.exitCode !== undefined ? ` · exit ${task.exitCode}` : ''}
                {task.started !== undefined
                  ? ` · ${Math.max(0, Math.round(((task.ended ?? now) - task.started) / 1000))}s`
                  : ''}
              </span>
              {task.status === 'running' && (
                <button
                  onClick={() => {
                    void window.viewer.executionCancel(task.id).catch(report);
                  }}
                >
                  Stop
                </button>
              )}
            </div>
            {task.error && <p role="alert">{task.error}</p>}
            {task.directory && <p className="muted">{task.directory}</p>}
            {task.truncated && <p role="status">Showing the last 256 KiB of output.</p>}
            {task.command && (
              <button onClick={() => workspace.openReceipt(task.id, task.directory)}>
                Open receipt
              </button>
            )}
            {!!task.output && (
              <button onClick={() => void navigator.clipboard.writeText(task.output).catch(report)}>
                Copy output
              </button>
            )}
            {task.output && <pre>{task.output}</pre>}
          </section>
        ))}
    </aside>
  );
}
