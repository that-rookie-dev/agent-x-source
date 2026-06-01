import { useState, useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import BuildIcon from '@mui/icons-material/Build';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { chat, connectSSE, type TelemetryEvent, type ChatMessage, type TodoItem } from '../api';
import { colors } from '../theme';

interface UIMessage extends ChatMessage {
  thinking?: string;
  toolCalls?: ToolCall[];
  subAgents?: SubAgent[];
  todos?: TodoItem[];
  streaming?: boolean;
  plan?: string[];
}

interface ToolCall {
  id: string;
  name: string;
  args?: string;
  result?: string;
  status: 'running' | 'done' | 'error';
}

interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const disconnectRef = useRef<(() => void) | null>(null);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Connect SSE for streaming events
  useEffect(() => {
    const handleEvent = (ev: TelemetryEvent) => {
      setMessages((prev) => {
        const msgs = [...prev];
        const last = msgs[msgs.length - 1];

        switch (ev.type) {
          case 'stream_start':
            msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true });
            setStreaming(true);
            break;

          case 'stream_token':
          case 'token':
            if (last?.role === 'assistant' && last.streaming) {
              last.content += (ev.token as string) ?? '';
            }
            break;

          case 'stream_end':
          case 'response_complete':
            if (last?.role === 'assistant') last.streaming = false;
            setStreaming(false);
            break;

          case 'thinking_start':
          case 'reasoning':
            if (last?.role === 'assistant') {
              last.thinking = (last.thinking ?? '') + ((ev.content as string) ?? '');
            }
            break;

          case 'tool_start':
          case 'tool_call': {
            if (last?.role === 'assistant') {
              const tc: ToolCall = { id: (ev.callId as string) ?? crypto.randomUUID(), name: (ev.toolName ?? ev.name) as string, args: ev.args as string, status: 'running' };
              last.toolCalls = [...(last.toolCalls ?? []), tc];
            }
            break;
          }

          case 'tool_end':
          case 'tool_result': {
            if (last?.role === 'assistant' && last.toolCalls) {
              const tc = last.toolCalls.find((t) => t.id === ev.callId || t.name === ev.toolName);
              if (tc) { tc.status = 'done'; tc.result = (ev.result ?? ev.output) as string; }
            }
            break;
          }

          case 'sub_agent_spawn': {
            if (last?.role === 'assistant') {
              const sa: SubAgent = { id: (ev.agentId as string) ?? crypto.randomUUID(), name: (ev.agentName as string) ?? 'Sub-Agent', task: (ev.task as string) ?? '', status: 'running' };
              last.subAgents = [...(last.subAgents ?? []), sa];
            }
            break;
          }

          case 'sub_agent_complete': {
            if (last?.role === 'assistant' && last.subAgents) {
              const sa = last.subAgents.find((a) => a.id === ev.agentId);
              if (sa) { sa.status = 'done'; sa.result = ev.result as string; }
            }
            break;
          }

          case 'todo_update': {
            if (last?.role === 'assistant') {
              last.todos = ev.items as TodoItem[];
            }
            break;
          }

          case 'plan_update': {
            if (last?.role === 'assistant') {
              last.plan = ev.steps as string[];
            }
            break;
          }

          case 'permission_request':
            setPermissionPrompt(ev.description as string);
            break;

          case 'error':
            if (last?.role === 'assistant') {
              last.content += `\n\n⚠️ Error: ${ev.message ?? ev.error}`;
              last.streaming = false;
            }
            setStreaming(false);
            break;

          default:
            break;
        }

        return msgs;
      });
    };

    disconnectRef.current = connectSSE(handleEvent);
    return () => { disconnectRef.current?.(); };
  }, []);

  // Load history on mount
  useEffect(() => {
    chat.history().then((h) => setMessages(h.map((m) => ({ ...m, streaming: false })))).catch(() => {});
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');

    // Add user message
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: text, streaming: false };
    setMessages((prev) => [...prev, userMsg]);

    try {
      await chat.send(text);
    } catch {
      // Error message will come through SSE
    }
  }, [input, streaming]);

  const handleCancel = async () => {
    try { await chat.cancel(); } catch { /* ignore */ }
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Messages area */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {messages.length === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Box sx={{ textAlign: 'center' }}>
              <SmartToyIcon sx={{ fontSize: 48, color: colors.text.dim, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.text.dim }}>Agent-X Console</Typography>
              <Typography variant="caption" sx={{ color: colors.text.dim }}>Send a message to begin</Typography>
            </Box>
          </Box>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {permissionPrompt && (
          <PermissionBanner prompt={permissionPrompt} onRespond={() => setPermissionPrompt(null)} />
        )}

        <div ref={bottomRef} />
      </Box>

      {/* Input area */}
      <Box sx={{ p: 2, borderTop: `1px solid ${colors.border.default}` }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Agent-X..."
            multiline
            maxRows={6}
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { bgcolor: colors.bg.tertiary } }}
          />
          {streaming ? (
            <IconButton onClick={handleCancel} sx={{ color: colors.accent.red }}>
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton onClick={handleSend} disabled={!input.trim()} sx={{ color: colors.accent.blue }}>
              <SendIcon />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─── Message Bubble ───

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);

  return (
    <Box sx={{ mb: 2, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      {/* Avatar */}
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: isUser ? colors.accent.blue + '20' : colors.accent.purple + '20',
        color: isUser ? colors.accent.blue : colors.accent.purple,
        mt: 0.5, flexShrink: 0,
      }}>
        {isUser ? <PersonIcon sx={{ fontSize: 16 }} /> : <SmartToyIcon sx={{ fontSize: 16 }} />}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Thinking */}
        {message.thinking && (
          <Box sx={{ mb: 1 }}>
            <Chip
              size="small"
              label={showThinking ? 'Hide reasoning' : 'Show reasoning'}
              onClick={() => setShowThinking(!showThinking)}
              icon={showThinking ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ fontSize: '0.65rem', bgcolor: colors.bg.tertiary }}
            />
            <Collapse in={showThinking}>
              <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}`, fontSize: '0.8rem', color: colors.text.tertiary, fontStyle: 'italic' }}>
                {message.thinking}
              </Box>
            </Collapse>
          </Box>
        )}

        {/* Plan */}
        {message.plan && message.plan.length > 0 && (
          <Box sx={{ mb: 1, p: 1, borderRadius: 1, border: `1px solid ${colors.accent.blue}30`, bgcolor: colors.accent.blue + '08' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: colors.accent.blue, mb: 0.5, display: 'block' }}>Plan</Typography>
            {message.plan.map((step, i) => (
              <Typography key={i} variant="caption" sx={{ display: 'block', color: colors.text.secondary, pl: 1 }}>
                {i + 1}. {step}
              </Typography>
            ))}
          </Box>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box sx={{ mb: 1 }}>
            {message.toolCalls.map((tc) => (
              <ToolCallChip key={tc.id} tool={tc} />
            ))}
          </Box>
        )}

        {/* Sub-agents */}
        {message.subAgents && message.subAgents.length > 0 && (
          <Box sx={{ mb: 1 }}>
            {message.subAgents.map((sa) => (
              <SubAgentChip key={sa.id} agent={sa} />
            ))}
          </Box>
        )}

        {/* Todos */}
        {message.todos && message.todos.length > 0 && (
          <TodoList items={message.todos} />
        )}

        {/* Main content (markdown) */}
        {message.content && (
          <Box sx={{ '& p': { m: 0, mb: 1 }, '& pre': { m: 0 }, '& code': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }, '& > *:last-child': { mb: 0 } }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className ?? '');
                  const code = String(children).replace(/\n$/, '');
                  if (match) {
                    return (
                      <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: 6, fontSize: '0.78rem', margin: '8px 0' }}>
                        {code}
                      </SyntaxHighlighter>
                    );
                  }
                  return <code className={className} style={{ background: colors.bg.tertiary, padding: '2px 5px', borderRadius: 3 }} {...props}>{children}</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </Box>
        )}

        {/* Streaming indicator */}
        {message.streaming && !message.content && (
          <Box sx={{ display: 'flex', gap: 0.5, py: 1 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.text.dim, animation: 'pulse 1.4s ease-in-out infinite' }} />
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.text.dim, animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.text.dim, animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Tool Call Chip ───

function ToolCallChip({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mb: 0.5 }}>
      <Chip
        size="small"
        icon={<BuildIcon sx={{ fontSize: 14 }} />}
        label={tool.name}
        onClick={() => setExpanded(!expanded)}
        onDelete={tool.status === 'running' ? undefined : undefined}
        deleteIcon={tool.status === 'running' ? <CircularProgress size={12} /> : undefined}
        sx={{
          fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
          bgcolor: tool.status === 'running' ? colors.accent.orange + '15' : tool.status === 'error' ? colors.accent.red + '15' : colors.accent.green + '15',
          border: `1px solid ${tool.status === 'running' ? colors.accent.orange : tool.status === 'error' ? colors.accent.red : colors.accent.green}30`,
        }}
      />
      <Collapse in={expanded}>
        {tool.args && <Box sx={{ mt: 0.5, p: 1, fontSize: '0.7rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.tertiary, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{tool.args}</Box>}
        {tool.result && <Box sx={{ mt: 0.5, p: 1, fontSize: '0.7rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{tool.result}</Box>}
      </Collapse>
    </Box>
  );
}

// ─── Sub-Agent Chip ───

function SubAgentChip({ agent }: { agent: SubAgent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mb: 0.5 }}>
      <Chip
        size="small"
        icon={<AccountTreeIcon sx={{ fontSize: 14 }} />}
        label={`${agent.name}: ${agent.task.slice(0, 40)}${agent.task.length > 40 ? '...' : ''}`}
        onClick={() => setExpanded(!expanded)}
        sx={{
          fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
          bgcolor: agent.status === 'running' ? colors.accent.purple + '15' : colors.accent.green + '15',
          border: `1px solid ${agent.status === 'running' ? colors.accent.purple : colors.accent.green}30`,
        }}
      />
      {agent.status === 'running' && <CircularProgress size={10} sx={{ ml: 1, color: colors.accent.purple }} />}
      <Collapse in={expanded}>
        {agent.result && <Box sx={{ mt: 0.5, p: 1, fontSize: '0.7rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{agent.result}</Box>}
      </Collapse>
    </Box>
  );
}

// ─── Todo List ───

function TodoList({ items }: { items: TodoItem[] }) {
  return (
    <Box sx={{ mb: 1, p: 1, borderRadius: 1, border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.tertiary }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <ChecklistIcon sx={{ fontSize: 14, color: colors.accent.blue }} />
        <Typography variant="caption" sx={{ fontWeight: 600, color: colors.accent.blue }}>Tasks</Typography>
      </Box>
      {items.map((item) => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: item.status === 'completed' ? colors.accent.green : item.status === 'in-progress' ? colors.accent.orange : colors.text.dim,
          }} />
          <Typography variant="caption" sx={{
            color: item.status === 'completed' ? colors.text.tertiary : colors.text.secondary,
            textDecoration: item.status === 'completed' ? 'line-through' : 'none',
          }}>
            {item.title}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─── Permission Banner ───

function PermissionBanner({ prompt, onRespond }: { prompt: string; onRespond: () => void }) {
  const handleRespond = async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await fetch('/api/permission/respond', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
    } catch { /* ignore */ }
    onRespond();
  };

  return (
    <Box sx={{ p: 2, mb: 2, borderRadius: 1, border: `1px solid ${colors.accent.orange}`, bgcolor: colors.accent.orange + '08' }}>
      <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, color: colors.accent.orange }}>
        Permission Required
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: colors.text.secondary }}>
        {prompt}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Chip size="small" label="Allow Once" onClick={() => handleRespond('allow_once')} sx={{ cursor: 'pointer', bgcolor: colors.accent.green + '20', color: colors.accent.green }} />
        <Chip size="small" label="Allow Always" onClick={() => handleRespond('allow_always')} sx={{ cursor: 'pointer', bgcolor: colors.accent.blue + '20', color: colors.accent.blue }} />
        <Chip size="small" label="Deny" onClick={() => handleRespond('deny')} sx={{ cursor: 'pointer', bgcolor: colors.accent.red + '20', color: colors.accent.red }} />
      </Box>
    </Box>
  );
}
