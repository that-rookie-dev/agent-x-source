import { useState, useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import LinearProgress from '@mui/material/LinearProgress';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BuildIcon from '@mui/icons-material/Build';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { chat, sessions, todos, tools, connectSSE, type TelemetryEvent, type ChatMessage, type TodoItem, type SessionInfo } from '../api';
import { colors } from '../theme';

// ─── CSS Keyframes (injected once) ───
const styleId = 'agentx-chat-keyframes';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes agentx-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
    @keyframes agentx-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes agentx-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  `;
  document.head.appendChild(style);
}

interface UIMessage extends ChatMessage {
  thinking?: string;
  toolCalls?: ToolCall[];
  subAgents?: SubAgent[];
  todos?: TodoItem[];
  streaming?: boolean;
  plan?: string[];
  attachments?: { name: string }[];
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

interface FileAttachment {
  name: string;
  content: string;
}

type ChatView = 'sessions' | 'chat';

export function ChatPanel() {
  const [view, setView] = useState<ChatView>('chat');
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<string | null>(null);
  const [toolEnablePrompt, setToolEnablePrompt] = useState<{ toolId: string; toolName: string } | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disconnectRef = useRef<(() => void) | null>(null);

  // Right sidebar state
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [tokenUsed, setTokenUsed] = useState(0);
  const [tokenTotal] = useState(128000);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streaming]);

  // Load sessions
  const loadSessions = useCallback(() => {
    sessions.list().then(setSessionList).catch(() => {});
  }, []);

  // Load todos
  const loadTodos = useCallback(() => {
    todos.list().then(setTodoItems).catch(() => {});
  }, []);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  // Connect SSE for streaming events
  useEffect(() => {
    const handleEvent = (ev: TelemetryEvent) => {
      setMessages((prev) => {
        const msgs = [...prev];
        const last = msgs[msgs.length - 1];

        switch (ev.type) {
          case 'loading_start':
            // Only add a new placeholder if there isn't one already
            if (!last || last.role !== 'assistant' || !last.streaming) {
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true });
            }
            setStreaming(true);
            break;

          case 'stream_chunk':
            if (last?.role === 'assistant' && last.streaming) {
              last.content = (ev.fullContent as string) ?? (last.content + ((ev.content as string) ?? ''));
            } else {
              // If no streaming placeholder exists, create one
              const newMsg: UIMessage = { id: crypto.randomUUID(), role: 'assistant', content: (ev.content as string) ?? '', streaming: true };
              msgs.push(newMsg);
              setStreaming(true);
            }
            break;

          case 'loading_end':
            if (last?.role === 'assistant') last.streaming = false;
            setStreaming(false);
            break;

          case 'message_received':
            if (last?.role === 'assistant') {
              const msg = ev.message as { content?: string } | undefined;
              if (msg?.content) last.content = msg.content;
              last.streaming = false;
            }
            setStreaming(false);
            break;

          case 'tool_executing': {
            if (last?.role === 'assistant') {
              const toolName = (ev.tool as string) ?? 'unknown';
              if (toolName === 'delegate_to_subagent') {
                const sa: SubAgent = { id: crypto.randomUUID(), name: 'Sub-Agent', task: (ev.description as string) ?? '', status: 'running' };
                last.subAgents = [...(last.subAgents ?? []), sa];
              } else {
                const tc: ToolCall = { id: crypto.randomUUID(), name: toolName, args: (ev.description as string) ?? '', status: 'running' };
                last.toolCalls = [...(last.toolCalls ?? []), tc];
              }
            }
            break;
          }

          case 'tool_complete': {
            if (last?.role === 'assistant') {
              const toolName = (ev.tool as string) ?? '';
              if (toolName === 'delegate_to_subagent' && last.subAgents) {
                const sa = last.subAgents.find((a) => a.status === 'running');
                if (sa) {
                  sa.status = 'done';
                  const result = ev.result as { output?: string; success?: boolean } | string | undefined;
                  sa.result = typeof result === 'string' ? result : result?.output ?? 'Done';
                }
              } else if (last.toolCalls) {
                const tc = last.toolCalls.find((t) => t.name === toolName && t.status === 'running');
                if (tc) {
                  tc.status = 'done';
                  const result = ev.result;
                  tc.result = typeof result === 'string' ? result : JSON.stringify(result ?? '');
                  const resObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null;
                  if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') {
                    setToolEnablePrompt({ toolId: toolName, toolName });
                  }
                }
              }
            }
            break;
          }

          case 'todo_update': {
            if (last?.role === 'assistant') {
              last.todos = ev.items as TodoItem[];
            }
            setTodoItems(ev.items as TodoItem[]);
            break;
          }

          case 'plan_generated': {
            if (last?.role === 'assistant') {
              const plan = ev.plan as { steps?: { description: string }[] } | undefined;
              if (plan?.steps) {
                last.plan = plan.steps.map((s) => s.description);
              }
            }
            break;
          }

          case 'token_usage': {
            const used = ev.totalTokens as number | undefined;
            if (used) setTokenUsed(used);
            break;
          }

          case 'decision_made': {
            // Show decision as thinking phase on the streaming assistant message
            if (last?.role === 'assistant' && last.streaming) {
              const path = (ev.executionPath as string) ?? '';
              const cls = (ev.messageClass as string) ?? '';
              last.thinking = `${cls} → ${path}`;
            }
            break;
          }

          case 'permission_required':
            setPermissionPrompt((ev.tool as string) + ': ' + ((ev.path as string) ?? ''));
            break;

          case 'error':
            if (last?.role === 'assistant') {
              last.content += `\n\n[ERROR] ${ev.message ?? ev.error}`;
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

  // Load history on mount — filter system messages
  useEffect(() => {
    chat.history().then((h) => {
      const visible = h.filter((m) => m.role !== 'system');
      setMessages(visible.map((m) => ({ ...m, streaming: false })));
      const totalTokens = h.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenUsed(totalTokens);
    }).catch(() => {});
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    setInput('');
    setStreaming(true);

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      streaming: false,
      attachments: attachments.map((a) => ({ name: a.name })),
    };
    // Add user message + a placeholder assistant message to show thinking immediately
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true },
    ]);

    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);

    try {
      const result = await chat.send(text, fileRefs);
      // Fallback: if SSE didn't deliver the response (e.g., first message before agent existed),
      // display the response from the API call directly
      if (result?.message?.content) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          // Only add if there's no assistant message already showing this content
          if (!last || last.role !== 'assistant' || (!last.content && last.streaming)) {
            // Replace the empty streaming placeholder or add new message
            if (last?.role === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { ...result.message, streaming: false }];
            }
            return [...prev, { ...result.message, streaming: false }];
          }
          return prev;
        });
        setStreaming(false);
      }
    } catch {
      // Errors come through SSE
      setStreaming(false);
    }
  }, [input, streaming, attachments]);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [...prev, { name: file.name, content: reader.result as string }]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleShowSessions = () => {
    loadSessions();
    setView('sessions');
  };

  const handleSelectSession = async (s: SessionInfo) => {
    try {
      await sessions.restore(s.id);
      const h = await chat.history();
      const visible = h.filter((m) => m.role !== 'system');
      setMessages(visible.map((m) => ({ ...m, streaming: false })));
      setCurrentSessionTitle(s.title ?? `Session ${s.id.slice(0, 8)}`);
      setCurrentSessionId(s.id);
      setTokenUsed(s.tokensUsed ?? 0);
      setView('chat');
      loadTodos();
    } catch { /* ignore */ }
  };

  const handleNewSession = async () => {
    try {
      const result = await sessions.create();
      setMessages([]);
      setCurrentSessionTitle(null);
      setCurrentSessionId(result?.sessionId ?? null);
      setTokenUsed(0);
      setTodoItems([]);
      setView('chat');
    } catch { /* ignore */ }
  };

  const handleDeleteSession = async (id: string) => {
    try { await sessions.delete(id); loadSessions(); } catch { /* ignore */ }
  };

  // Token percentage
  const tokenPercent = tokenTotal > 0 ? Math.min((tokenUsed / tokenTotal) * 100, 100) : 0;

  // ─── Sessions list view (NO chat input here) ───
  if (view === 'sessions') {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: colors.bg.primary }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border.default}`, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, flex: 1 }}>Sessions</Typography>
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={handleNewSession} sx={{ color: colors.accent.blue, fontSize: '0.65rem', textTransform: 'none' }}>
            New Session
          </Button>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
          <List disablePadding>
            {sessionList.map((s) => (
              <ListItemButton
                key={s.id}
                onClick={() => handleSelectSession(s)}
                sx={{ borderRadius: 1, mb: 0.5, border: `1px solid ${colors.border.default}`, px: 2, py: 1, '&:hover': { bgcolor: colors.bg.tertiary } }}
              >
                <ListItemText
                  primary={s.title ?? `Session ${s.id.slice(0, 8)}`}
                  secondary={`${s.messageCount} messages · ${(s.tokensUsed ?? 0).toLocaleString()} tokens`}
                  primaryTypographyProps={{ fontSize: '0.8rem', fontWeight: 500 }}
                  secondaryTypographyProps={{ fontSize: '0.6rem', color: colors.text.dim }}
                />
                <Chip size="small" label={new Date(s.createdAt).toLocaleDateString()} sx={{ mr: 1, fontSize: '0.5rem', height: 18 }} />
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }} sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
          {sessionList.length === 0 && (
            <Box sx={{ textAlign: 'center', mt: 6 }}>
              <Typography sx={{ color: colors.text.dim, fontSize: '0.8rem' }}>No sessions yet</Typography>
              <Button size="small" onClick={handleNewSession} sx={{ mt: 1, color: colors.accent.blue, textTransform: 'none', fontSize: '0.7rem' }}>Create your first session</Button>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // ─── Chat view ───
  const visibleMessages = messages.filter((m) => m.role !== 'system');

  return (
    <Box sx={{ height: '100%', display: 'flex' }}>
      {/* Main chat area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <Box sx={{ px: 1.5, py: 0.5, borderBottom: `1px solid ${colors.border.default}`, display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 36 }}>
          <IconButton size="small" onClick={handleShowSessions} sx={{ color: colors.text.dim, p: 0.5 }}>
            <ArrowBackIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentSessionTitle ?? 'New Session'}
          </Typography>
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 12 }} />} onClick={handleNewSession}
            sx={{ color: colors.accent.green, fontSize: '0.55rem', textTransform: 'none', minWidth: 'auto' }}>
            New
          </Button>
        </Box>

        {/* Messages */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
          {visibleMessages.length === 0 && !streaming && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Box sx={{ textAlign: 'center', maxWidth: 300 }}>
                <SmartToyIcon sx={{ fontSize: 36, color: colors.border.strong, mb: 1 }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 500, color: colors.text.secondary, mb: 0.5 }}>How can I help?</Typography>
                <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, lineHeight: 1.5 }}>
                  Send a message, attach files, or ask me to execute tasks.
                </Typography>
              </Box>
            </Box>
          )}

          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Thinking indicator — shows when streaming starts but no assistant message yet */}
          {streaming && (visibleMessages.length === 0 || (visibleMessages[visibleMessages.length - 1]?.role !== 'assistant')) && (
            <ThinkingIndicator />
          )}

          {permissionPrompt && (
            <PermissionBanner prompt={permissionPrompt} onRespond={() => setPermissionPrompt(null)} />
          )}

          {toolEnablePrompt && (
            <ToolEnableBanner toolId={toolEnablePrompt.toolId} toolName={toolEnablePrompt.toolName} onRespond={() => setToolEnablePrompt(null)} />
          )}

          <div ref={bottomRef} />
        </Box>

        {/* Input area */}
        <Box sx={{ px: 2, pb: 1.5, pt: 1 }}>
          {/* Attachment chips */}
          {attachments.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
              {attachments.map((a, i) => (
                <Chip
                  key={i}
                  size="small"
                  icon={<InsertDriveFileIcon sx={{ fontSize: '13px !important' }} />}
                  label={a.name}
                  onDelete={() => handleRemoveAttachment(i)}
                  deleteIcon={<CloseIcon sx={{ fontSize: '13px !important' }} />}
                  sx={{ fontSize: '0.6rem', height: 22, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}
                />
              ))}
            </Box>
          )}

          {/* Input container */}
          <Box sx={{
            display: 'flex', alignItems: 'flex-end', gap: 0.5,
            border: `1px solid ${colors.border.default}`, borderRadius: '12px',
            bgcolor: colors.bg.tertiary, px: 1.25, py: 0.5,
            transition: 'border-color 0.2s',
            '&:focus-within': { borderColor: colors.border.strong },
          }}>
            <IconButton size="small" onClick={() => fileInputRef.current?.click()} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.text.secondary } }}>
              <AttachFileIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelect} accept=".txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.toml,.csv,.xml,.html,.css,.sh,.sql,.log,.env,.cfg,.ini,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt" />

            <Box
              component="textarea"
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Agent-X..."
              sx={{
                flex: 1, border: 'none', outline: 'none', resize: 'none',
                bgcolor: 'transparent', color: colors.text.primary,
                fontFamily: "'Inter', sans-serif", fontSize: '0.8rem',
                lineHeight: 1.5, py: 0.75, px: 0.5,
                minHeight: 24, maxHeight: 120, overflow: 'auto',
                '&::placeholder': { color: colors.text.dim },
              }}
              rows={1}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />

            {streaming ? (
              <IconButton size="small" onClick={handleCancel} sx={{ color: colors.accent.red, p: 0.5 }}>
                <StopIcon sx={{ fontSize: 20 }} />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                onClick={handleSend}
                disabled={!input.trim() && attachments.length === 0}
                sx={{ color: colors.accent.blue, p: 0.5, '&.Mui-disabled': { color: colors.text.dim } }}
              >
                <SendIcon sx={{ fontSize: 20 }} />
              </IconButton>
            )}
          </Box>

          <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, textAlign: 'center', mt: 0.5, opacity: 0.7 }}>
            Agent-X may produce inaccurate information. Verify important details.
          </Typography>
        </Box>
      </Box>

      {/* ─── Right sidebar ─── */}
      <Box sx={{
        width: 210, flexShrink: 0, borderLeft: `1px solid ${colors.border.default}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <Box sx={{ p: 1.5, borderBottom: `1px solid ${colors.border.default}` }}>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', mb: 0.75 }}>
            TOKEN USAGE
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.primary }}>
              {tokenUsed.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
              / {tokenTotal.toLocaleString()}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={tokenPercent}
            sx={{
              height: 3, borderRadius: 2, bgcolor: colors.bg.tertiary,
              '& .MuiLinearProgress-bar': {
                bgcolor: tokenPercent > 80 ? colors.accent.red : tokenPercent > 50 ? colors.accent.orange : colors.accent.blue,
              },
            }}
          />
          <Box sx={{ mt: 0.75, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Est. cost</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              ~${((tokenUsed / 1000000) * 3).toFixed(4)}
            </Typography>
          </Box>

          {currentSessionId && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${colors.border.subtle}` }}>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SESSION</Typography>
              <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, mt: 0.25, wordBreak: 'break-all' }}>
                {currentSessionId}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Tasks */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px' }}>
              TASKS
            </Typography>
            <Box sx={{ flex: 1 }} />
            {todoItems.length > 0 && (
              <Chip size="small" label={`${todoItems.filter(t => t.status === 'completed').length}/${todoItems.length}`} sx={{ fontSize: '0.45rem', height: 15 }} />
            )}
          </Box>

          {todoItems.map((item) => (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.3 }}>
              {item.status === 'completed' && <CheckCircleIcon sx={{ fontSize: 10, color: colors.accent.green }} />}
              {item.status === 'in-progress' && <PlayCircleIcon sx={{ fontSize: 10, color: colors.accent.orange }} />}
              {item.status === 'not-started' && <RadioButtonUncheckedIcon sx={{ fontSize: 10, color: colors.text.dim }} />}
              <Typography sx={{
                fontSize: '0.55rem', color: item.status === 'completed' ? colors.text.dim : colors.text.secondary,
                textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                lineHeight: 1.3,
              }}>
                {item.title}
              </Typography>
            </Box>
          ))}

          {todoItems.length === 0 && (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.55rem', textAlign: 'center', mt: 3 }}>
              No active tasks
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─── Thinking Indicator ───

function ThinkingIndicator() {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: colors.accent.purple + '15', mt: 0.5, flexShrink: 0,
      }}>
        <SmartToyIcon sx={{ fontSize: 15, color: colors.accent.purple }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.4 }}>
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite' }} />
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.2s infinite' }} />
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.4s infinite' }} />
        </Box>
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic' }}>Thinking...</Typography>
      </Box>
    </Box>
  );
}

// ─── Message Bubble ───

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);

  if (message.role === 'system') return null;

  return (
    <Box sx={{
      mb: 2, display: 'flex', gap: 1.5,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      animation: 'agentx-fadeIn 0.25s ease-out',
    }}>
      {/* Avatar — only for assistant */}
      {!isUser && (
        <Box sx={{
          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: colors.accent.purple + '15', mt: 0.5, flexShrink: 0,
        }}>
          <SmartToyIcon sx={{ fontSize: 15, color: colors.accent.purple }} />
        </Box>
      )}

      {/* Bubble content */}
      <Box sx={{
        maxWidth: isUser ? '72%' : '85%', minWidth: 0,
        ...(isUser ? {
          bgcolor: colors.accent.blue + '10',
          border: `1px solid ${colors.accent.blue}20`,
          borderRadius: '14px 14px 4px 14px',
          px: 1.75, py: 1,
        } : {}),
      }}>
        {/* Thinking */}
        {message.thinking && (
          <Box sx={{ mb: 0.75 }}>
            <Chip size="small" label={showThinking ? 'Hide reasoning' : 'Show reasoning'} onClick={() => setShowThinking(!showThinking)} icon={showThinking ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ fontSize: '0.55rem', bgcolor: colors.bg.tertiary, height: 20 }} />
            <Collapse in={showThinking}>
              <Box sx={{ mt: 0.5, p: 1, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}`, fontSize: '0.7rem', color: colors.text.dim, fontStyle: 'italic' }}>
                {message.thinking}
              </Box>
            </Collapse>
          </Box>
        )}

        {/* Plan */}
        {message.plan && message.plan.length > 0 && (
          <Box sx={{ mb: 0.75, p: 1, borderRadius: 1, border: `1px solid ${colors.accent.blue}20`, bgcolor: colors.accent.blue + '05' }}>
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.accent.blue, mb: 0.3 }}>Plan</Typography>
            {message.plan.map((step, i) => (
              <Typography key={i} sx={{ fontSize: '0.6rem', color: colors.text.secondary, pl: 1 }}>{i + 1}. {step}</Typography>
            ))}
          </Box>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box sx={{ mb: 0.75 }}>{message.toolCalls.map((tc) => (<ToolCallChip key={tc.id} tool={tc} />))}</Box>
        )}

        {/* Sub agents */}
        {message.subAgents && message.subAgents.length > 0 && (
          <Box sx={{ mb: 0.75 }}>{message.subAgents.map((sa) => (<SubAgentChip key={sa.id} agent={sa} />))}</Box>
        )}

        {/* Inline todos */}
        {message.todos && message.todos.length > 0 && (<InlineTodoList items={message.todos} />)}

        {/* File attachments on user messages */}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
            {message.attachments.map((a, i) => (
              <Chip key={i} size="small" icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />} label={a.name}
                sx={{ fontSize: '0.5rem', height: 18, bgcolor: colors.accent.blue + '08', border: `1px solid ${colors.accent.blue}20` }} />
            ))}
          </Box>
        )}

        {/* Message text */}
        {message.content && (
          <Box sx={{
            '& p': { m: 0, mb: 0.5, fontSize: '0.8rem', lineHeight: 1.6, color: colors.text.primary },
            '& p:last-child': { mb: 0 },
            '& pre': { m: 0 },
            '& code': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem' },
            '& ul, & ol': { pl: 2.5, my: 0.5, fontSize: '0.8rem' },
            '& li': { mb: 0.25 },
            '& blockquote': { borderLeft: `3px solid ${colors.border.strong}`, pl: 1.5, ml: 0, my: 0.5, color: colors.text.secondary },
            '& a': { color: colors.accent.blue, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className ?? '');
                const code = String(children).replace(/\n$/, '');
                if (match) {
                  return (<SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: 6, fontSize: '0.7rem', margin: '6px 0', padding: '10px 12px' }}>{code}</SyntaxHighlighter>);
                }
                return <code className={className} style={{ background: colors.bg.tertiary, padding: '1px 5px', borderRadius: 3, fontSize: '0.72rem' }} {...props}>{children}</code>;
              },
            }}>{message.content}</ReactMarkdown>
          </Box>
        )}

        {/* Streaming dots (empty content) */}
        {message.streaming && !message.content && (
          <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite' }} />
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.4s infinite' }} />
          </Box>
        )}

        {/* Shimmer bar while streaming content */}
        {message.streaming && message.content && (
          <Box sx={{
            mt: 0.5, height: 2, borderRadius: 1, width: '50%',
            background: `linear-gradient(90deg, transparent, ${colors.accent.purple}50, transparent)`,
            backgroundSize: '200% 100%',
            animation: 'agentx-shimmer 1.5s infinite linear',
          }} />
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
      <Chip size="small"
        icon={tool.status === 'running' ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <BuildIcon sx={{ fontSize: 11 }} />}
        label={tool.name}
        onClick={() => setExpanded(!expanded)}
        sx={{
          fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", height: 20,
          bgcolor: tool.status === 'running' ? colors.accent.orange + '10' : tool.status === 'error' ? colors.accent.red + '10' : colors.accent.green + '10',
          border: `1px solid ${tool.status === 'running' ? colors.accent.orange : tool.status === 'error' ? colors.accent.red : colors.accent.green}20`,
          color: tool.status === 'running' ? colors.accent.orange : tool.status === 'error' ? colors.accent.red : colors.accent.green,
          cursor: 'pointer',
        }}
      />
      <Collapse in={expanded}>
        {tool.args && <Box sx={{ mt: 0.5, p: 0.75, fontSize: '0.55rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto' }}>{tool.args}</Box>}
        {tool.result && <Box sx={{ mt: 0.5, p: 0.75, fontSize: '0.55rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto' }}>{tool.result}</Box>}
      </Collapse>
    </Box>
  );
}

// ─── Sub-Agent Chip ───

function SubAgentChip({ agent }: { agent: SubAgent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mb: 0.5 }}>
      <Chip size="small"
        icon={agent.status === 'running' ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <AccountTreeIcon sx={{ fontSize: 11 }} />}
        label={`${agent.name}: ${agent.task.slice(0, 35)}${agent.task.length > 35 ? '…' : ''}`}
        onClick={() => setExpanded(!expanded)}
        sx={{
          fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", height: 20,
          bgcolor: agent.status === 'running' ? colors.accent.purple + '10' : colors.accent.green + '10',
          border: `1px solid ${agent.status === 'running' ? colors.accent.purple : colors.accent.green}20`,
          color: agent.status === 'running' ? colors.accent.purple : colors.accent.green,
          cursor: 'pointer',
        }}
      />
      <Collapse in={expanded}>
        {agent.result && <Box sx={{ mt: 0.5, p: 0.75, fontSize: '0.55rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{agent.result}</Box>}
      </Collapse>
    </Box>
  );
}

// ─── Inline Todo List ───

function InlineTodoList({ items }: { items: TodoItem[] }) {
  return (
    <Box sx={{ mb: 0.75, p: 1, borderRadius: 1, border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.tertiary }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
        <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.accent.blue }}>Tasks</Typography>
      </Box>
      {items.map((item) => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.2 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: item.status === 'completed' ? colors.accent.green : item.status === 'in-progress' ? colors.accent.orange : colors.text.dim, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.55rem', color: item.status === 'completed' ? colors.text.dim : colors.text.secondary, textDecoration: item.status === 'completed' ? 'line-through' : 'none' }}>
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
      await fetch('/api/permission/respond', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    } catch { /* ignore */ }
    onRespond();
  };

  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: 1, border: `1px solid ${colors.accent.orange}30`, bgcolor: colors.accent.orange + '05', animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.orange, mb: 0.5 }}>Permission Required</Typography>
      <Typography sx={{ fontSize: '0.6rem', mb: 1, color: colors.text.secondary }}>{prompt}</Typography>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Allow Once" onClick={() => handleRespond('allow_once')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.green + '12', color: colors.accent.green, '&:hover': { bgcolor: colors.accent.green + '25' } }} />
        <Chip size="small" label="Always" onClick={() => handleRespond('allow_always')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.blue + '12', color: colors.accent.blue, '&:hover': { bgcolor: colors.accent.blue + '25' } }} />
        <Chip size="small" label="Deny" onClick={() => handleRespond('deny')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.red + '12', color: colors.accent.red, '&:hover': { bgcolor: colors.accent.red + '25' } }} />
      </Box>
    </Box>
  );
}

// ─── Tool Enable Banner ───

function ToolEnableBanner({ toolId, toolName, onRespond }: { toolId: string; toolName: string; onRespond: () => void }) {
  const handleEnable = async () => {
    try { await tools.toggle(toolId, true); } catch { /* ignore */ }
    onRespond();
  };

  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: 1, border: `1px solid ${colors.accent.purple}30`, bgcolor: colors.accent.purple + '05', animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.purple, mb: 0.5 }}>Tool Disabled</Typography>
      <Typography sx={{ fontSize: '0.6rem', mb: 1, color: colors.text.secondary }}>
        The agent needs <strong>{toolName}</strong> but it&apos;s disabled.
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Enable" onClick={handleEnable} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.green + '12', color: colors.accent.green, '&:hover': { bgcolor: colors.accent.green + '25' } }} />
        <Chip size="small" label="Keep Disabled" onClick={onRespond} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.red + '12', color: colors.accent.red, '&:hover': { bgcolor: colors.accent.red + '25' } }} />
      </Box>
    </Box>
  );
}
