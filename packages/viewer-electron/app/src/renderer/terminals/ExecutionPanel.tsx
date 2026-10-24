import { useEffect, useState } from 'react';
import type { ExecutionTask } from '../../domain/automation/actions';
import { report } from '../state/store';
import { IconButton } from '../ui/primitives';
export function ExecutionPanel() {
  const [tasks, setTasks] = useState<ExecutionTask[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    void window.viewer.executionList().then(setTasks).catch(report);
    return window.viewer.onEvent((event) => {
      if (event.type === 'execution') {
        setDismissed(false);
        setTasks((tasks) =>
          [...tasks.filter((task) => task.id !== event.task.id), event.task].slice(-20),
        );
      }
    });
  }, []);
  if (!tasks.length || dismissed) return null;
  const running = tasks.filter((task) => task.status === 'running').length;
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
              </span>
              {task.status === 'running' && (
                <button
                  onClick={() => {
                    void window.viewer.executionCancel(task.id).catch(report);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            {task.error && <p role="alert">{task.error}</p>}
            {task.output && <pre>{task.output}</pre>}
          </section>
        ))}
    </aside>
  );
}
