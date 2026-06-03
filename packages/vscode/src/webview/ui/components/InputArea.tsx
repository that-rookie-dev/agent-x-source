import { useState, useRef, useCallback, useEffect } from 'react';

interface InputAreaProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  onSteer: (instruction: string) => void;
  isProcessing: boolean;
}

const SLASH_COMMANDS = [
  { command: '/help', description: 'Show help' },
  { command: '/clear', description: 'Clear chat' },
  { command: '/compact', description: 'Compact context' },
  { command: '/model', description: 'Switch model' },
  { command: '/provider', description: 'Switch provider' },
  { command: '/crew', description: 'Switch crew' },
  { command: '/plan', description: 'Toggle plan mode' },
  { command: '/cost', description: 'Show token usage' },
  { command: '/steer', description: 'Send steer instruction' },
  { command: '/cancel', description: 'Cancel current task' },
];

export function InputArea({ onSend, onCancel, onSteer, isProcessing }: InputAreaProps) {
  const [value, setValue] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.command.toLowerCase().startsWith(slashFilter.toLowerCase()),
  );

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => { adjustHeight(); }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (isProcessing) { onSteer(trimmed); } else { onSend(trimmed); }
    setValue('');
    setShowSlashMenu(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, isProcessing, onSend, onSteer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSlashIndex((p) => Math.min(p + 1, filteredCommands.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSlashIndex((p) => Math.max(p - 1, 0)); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredCommands[selectedSlashIndex];
        if (cmd) { setValue(cmd.command + ' '); setShowSlashMenu(false); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setShowSlashMenu(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [showSlashMenu, filteredCommands, selectedSlashIndex, handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (newValue.startsWith('/') && !newValue.includes(' ')) {
      setShowSlashMenu(true); setSlashFilter(newValue); setSelectedSlashIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  }, []);

  return (
    <div className="input-area">
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="slash-menu">
          {filteredCommands.map((cmd, index) => (
            <div key={cmd.command} className={`slash-menu-item ${index === selectedSlashIndex ? 'selected' : ''}`}
              onClick={() => { setValue(cmd.command + ' '); setShowSlashMenu(false); textareaRef.current?.focus(); }}>
              <span className="slash-menu-command">{cmd.command}</span>
              <span className="slash-menu-description">{cmd.description}</span>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea ref={textareaRef} className="input-textarea" value={value}
          onChange={handleChange} onKeyDown={handleKeyDown}
          placeholder={isProcessing ? 'Type a steer message...' : 'Type a message or / for commands...'} rows={1}
          aria-label="Message input" />
        <div className="input-actions">
          {isProcessing ? (
            <>
              <button className="input-btn input-btn-steer" onClick={handleSend} disabled={!value.trim()} title="Send steer message" aria-label="Send steer instruction">
                <span className="codicon codicon-megaphone" />
              </button>
              <button className="input-btn input-btn-cancel" onClick={onCancel} title="Cancel processing" aria-label="Cancel message generation">
                <span className="codicon codicon-stop-circle" />
              </button>
            </>
          ) : (
            <button className="input-btn input-btn-send" onClick={handleSend} disabled={!value.trim()} title="Send message" aria-label="Send message">
              <span className="codicon codicon-send" />
            </button>
          )}
        </div>
      </div>
      <div className="input-footer">
        <span className="input-char-count">{value.length > 0 ? `${value.length} chars` : ''}</span>
        {isProcessing && <span className="input-steer-hint">Agent is busy — messages sent as steer instructions</span>}
      </div>
    </div>
  );
}
