import { useState, useMemo, useCallback, memo } from 'react';
import type { ChatMessage } from '../App';
import { renderMarkdown } from '../markdown';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const htmlContent = useMemo(() => {
    if (message.role === 'tool') {
      return `<pre class="tool-output">${escapeHtml(message.content)}</pre>`;
    }
    return renderMarkdown(message.content);
  }, [message.content, message.role]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content]);

  const roleClass = `message-${message.role}`;
  const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  });

  if (message.role === 'tool') {
    return (
      <div className={`message-bubble ${roleClass}`}>
        <div className="message-header" onClick={() => setCollapsed(!collapsed)}>
          <span className="tool-icon codicon codicon-terminal" />
          <span className="tool-name">{message.toolName || 'Tool Result'}</span>
          <span className={`tool-status tool-status-${message.toolStatus || 'success'}`}>
            {message.toolStatus === 'running' ? 'Running' : message.toolStatus === 'error' ? 'Failed' : 'Done'}
          </span>
          <span className="collapse-toggle">{collapsed ? '+' : '-'}</span>
        </div>
        {!collapsed && (
          <div className="message-content markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        )}
        <div className="message-footer">
          <span className="message-timestamp">{timestamp}</span>
          {message.toolElapsed !== undefined && (
            <span className="message-elapsed">{(message.toolElapsed / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`message-bubble ${roleClass}`}>
      <div className="message-content markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      <div className="message-footer">
        <span className="message-timestamp">{timestamp}</span>
        {message.tokenCost !== undefined && (
          <span className="message-cost">{message.tokenCost} tokens</span>
        )}
        <button className="copy-button" onClick={handleCopy} title="Copy message">
          <span className={`codicon codicon-${copied ? 'check' : 'copy'}`} />
        </button>
      </div>
    </div>
  );
});

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}
