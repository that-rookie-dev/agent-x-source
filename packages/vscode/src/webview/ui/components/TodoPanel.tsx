import { useState } from 'react';
import type { TodoItem } from '../App';

interface TodoPanelProps {
  items: TodoItem[];
}

const statusIcon: Record<TodoItem['status'], string> = {
  'pending': '\u25cb',
  'in-progress': '\u25d0',
  'completed': '\u25cf',
};

const statusColor: Record<TodoItem['status'], string> = {
  'pending': 'var(--vscode-descriptionForeground)',
  'in-progress': 'var(--vscode-charts-blue)',
  'completed': 'var(--vscode-charts-green)',
};

export function TodoPanel({ items }: TodoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const total = items.length;
  const completed = items.filter(i => i.status === 'completed').length;
  const current = items.find(i => i.status === 'in-progress');
  const progress = total > 0 ? (completed / total) * 100 : 0;

  if (items.length === 0) return null;

  return (
    <div className="todo-panel">
      <div className="todo-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="codicon codicon-checklist" />
        <span>TODOS</span>
        <span className="todo-count">{completed}/{total} done</span>
        <span className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
      </div>
      <div className="todo-progress-bar">
        <div className="todo-progress-fill" style={{
          width: `${progress}%`,
          background: progress === 100 ? 'var(--vscode-charts-green)' : 'var(--vscode-progressBar-background)',
        }} />
      </div>
      {current && !collapsed && (
        <div className="todo-current">
          Working on: {current.text}
        </div>
      )}
      {!collapsed && (
        <div className="todo-list">
          {items.map((item) => (
            <div key={item.id} className="todo-item">
              <span className="todo-item-icon" style={{ color: statusColor[item.status] }}>
                {statusIcon[item.status]}
              </span>
              <span className={`todo-item-text ${item.status === 'completed' ? 'todo-item-done' : ''}`}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
