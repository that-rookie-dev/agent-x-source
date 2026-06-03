import { useState, useEffect, useRef } from 'react';

interface BackgroundTask {
  id: string;
  command: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: string;
  createdAt: number;
  completedAt?: number;
}

interface BackgroundTasksProps {
  tasks: BackgroundTask[];
  onCancel: (taskId: string) => void;
}

const taskStatusIcon: Record<BackgroundTask['status'], string> = {
  queued: '\u23f3',
  running: '\u25b6\ufe0f',
  completed: '\u2705',
  failed: '\u274c',
  cancelled: '\u26d4',
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function TaskRow({ task, onCancel }: { task: BackgroundTask; onCancel: (id: string) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (task.status === 'running') {
      setElapsed(Date.now() - task.createdAt);
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - task.createdAt);
      }, 1000);
    } else if (task.completedAt) {
      setElapsed(task.completedAt - task.createdAt);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [task.status, task.createdAt, task.completedAt]);

  const isActive = task.status === 'queued' || task.status === 'running';
  const cmdPreview = task.command.length > 50 ? task.command.slice(0, 47) + '...' : task.command;

  return (
    <div className={`background-task-row ${isActive ? 'background-task-active' : ''}`}>
      <span>{taskStatusIcon[task.status]}</span>
      <div className="background-task-info">
        <div className="background-task-command">{cmdPreview}</div>
        <div className="background-task-meta">{formatDuration(elapsed)} — {task.progress}</div>
      </div>
      {isActive && (
        <button className="background-task-cancel" onClick={() => onCancel(task.id)}>Cancel</button>
      )}
    </div>
  );
}

export function BackgroundTasks({ tasks, onCancel }: BackgroundTasksProps) {
  if (tasks.length === 0) return null;

  const active = tasks.filter(t => t.status === 'queued' || t.status === 'running');
  const finished = tasks.filter(t => t.status !== 'queued' && t.status !== 'running');

  return (
    <div className="background-tasks-panel">
      <div className="background-tasks-header">
        <span>Background Tasks</span>
        <span className="background-tasks-count">{active.length} active</span>
      </div>
      {[...active, ...finished.slice(0, 3)].map(task => (
        <TaskRow key={task.id} task={task} onCancel={onCancel} />
      ))}
      {finished.length > 3 && (
        <div className="background-tasks-more">+{finished.length - 3} more completed</div>
      )}
    </div>
  );
}
