import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { isIntegrationToolId } from '@agentx/shared/browser';
import { colors } from '../theme';
import { getToolDisplay } from './tool-display';
import { ShellRender, ReadRender, EditRender, GlobRender, GrepRender, TaskRender } from './tool-renders';
import { IntegrationResultRender, type IntegrationStructuredResult } from './integrations/IntegrationResultRender';

export interface InlineToolData {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  streamOutput?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: Record<string, unknown>;
}

function getColor(status: string): string {
  if (status === 'running') return colors.accent.blue;
  if (status === 'error') return colors.accent.purple;
  return colors.accent.green;
}

const EDIT_TOOLS = new Set(['file_write', 'file_patch', 'code_replace', 'code_insert']);

function IntegrationToolRender({ tool }: { tool: InlineToolData }) {
  const structured = tool.metadata?.integrationStructured as IntegrationStructuredResult | undefined;
  if (structured) {
    return <IntegrationResultRender result={structured} />;
  }
  const result = tool.result;
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.blue}15` }}>
      {result ? (
        <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {result.slice(0, 4000)}
        </Typography>
      ) : (
        <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>No output</Typography>
      )}
    </Box>
  );
}

function getToolRenderer(tool: InlineToolData): ((props: { tool: InlineToolData }) => JSX.Element) | null {
  if (isIntegrationToolId(tool.name)) return IntegrationToolRender;
  const SHELL_TOOLS = new Set(['shell_exec', 'shell_exec_streaming', 'shell_background']);
  const READ_TOOLS = new Set(['file_read']);
  const EDIT_TOOLS = new Set(['file_write', 'file_patch', 'code_replace', 'code_insert']);
  const GLOB_TOOLS = new Set(['glob', 'file_find']);
  const GREP_TOOLS = new Set(['grep', 'code_grep', 'code_search']);
  const TASK_TOOLS = new Set(['delegate_to_subagent', 'sub_agent_spawn']);

  if (SHELL_TOOLS.has(tool.name)) return ShellRender;
  if (READ_TOOLS.has(tool.name)) return ReadRender;
  if (EDIT_TOOLS.has(tool.name)) return EditRender;
  if (GLOB_TOOLS.has(tool.name)) return GlobRender;
  if (GREP_TOOLS.has(tool.name)) return GrepRender;
  if (TASK_TOOLS.has(tool.name)) return TaskRender;
  return null;
}

export function InlineToolCall({ tool, compactTop }: { tool: InlineToolData; compactTop?: boolean }) {
  const isEditTool = EDIT_TOOLS.has(tool.name);
  const isDeepSearchTool = tool.name === 'deep_web_search';
  const hasDiff = !!(tool.metadata?.diff || (tool.result && tool.result.includes('---') && tool.result.includes('+++')));
  const [expanded, setExpanded] = useState(isEditTool && hasDiff);
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (isEditTool && hasDiff && !autoExpandedRef.current) {
      setExpanded(true);
      autoExpandedRef.current = true;
    }
  }, [isEditTool, hasDiff]);
  const cc = getColor(tool.status);
  const display = getToolDisplay(tool.name, tool.args);
  const headerRef = useRef<HTMLDivElement>(null);
  const SpecializedRender = getToolRenderer(tool);

  const [liveElapsed, setLiveElapsed] = useState(0);
  useEffect(() => {
    if (tool.status !== 'running') { setLiveElapsed(0); return; }
    const start = Date.now();
    const timer = setInterval(() => setLiveElapsed(Date.now() - start), 200);
    return () => clearInterval(timer);
  }, [tool.status, tool.id]);

  const elapsed = tool.elapsed != null
    ? `${tool.elapsed >= 1000 ? (tool.elapsed / 1000).toFixed(1) + 's' : tool.elapsed + 'ms'}`
    : tool.status === 'running'
      ? `${liveElapsed >= 1000 ? (liveElapsed / 1000).toFixed(1) + 's' : liveElapsed + 'ms'}`
      : null;

  const marker = tool.status === 'running' ? '│' : tool.status === 'error' ? '✕' : '✓';

  return (
    <Box sx={{
      mb: 0.25,
      mt: compactTop ? -0.625 : 0,
      borderRadius: 1, overflow: 'hidden',
      border: `1px solid ${cc}20`,
      bgcolor: `${cc}04`,
      transition: 'border-color 0.15s',
    }}>
      <Box
        ref={headerRef}
        onClick={() => !isDeepSearchTool && tool.status !== 'running' && setExpanded(e => !e)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.625, py: 0.75, px: 1,
          opacity: tool.status === 'running' ? 0.7 : 1,
          cursor: isDeepSearchTool ? 'default' : (tool.status === 'running' ? 'default' : 'pointer'),
          '&:hover': !isDeepSearchTool && tool.status !== 'running' ? { bgcolor: `${cc}08` } : {},
        }}
      >
        <Typography sx={{
          fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
          color: cc, flexShrink: 0, lineHeight: 1,
          ...(tool.status === 'running' ? { animation: 'agentx-pulse 1.4s ease-in-out infinite' } : {}),
        }}>
          {marker}
        </Typography>

        <Box sx={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', flexShrink: 0, color: cc }}>
          {display.icon}
        </Box>

        <Typography sx={{
          fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
          color: colors.text.primary, lineHeight: 1.2, flexShrink: 0,
        }}>
          {display.title}
        </Typography>

        <Typography sx={{
          fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
          color: colors.text.secondary, lineHeight: 1.2, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
        }}>
          {display.subtitle}
        </Typography>

        {elapsed && (
          <Typography sx={{
            fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace",
            color: colors.text.dim, flexShrink: 0,
          }}>
            {elapsed}
          </Typography>
        )}

        {tool.status !== 'running' && !isDeepSearchTool && (
          <Typography sx={{
            fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
            color: colors.text.dim, flexShrink: 0, transition: 'transform 0.15s',
            transform: expanded ? 'rotate(180deg)' : 'none',
          }}>
            ▾
          </Typography>
        )}
      </Box>

      {expanded && SpecializedRender && !isDeepSearchTool && (
        <SpecializedRender tool={tool} />
      )}

      {expanded && !SpecializedRender && !isDeepSearchTool && (
        <DefaultDetailsPanel tool={tool} cc={cc} />
      )}
    </Box>
  );
}

function DefaultDetailsPanel({ tool, cc }: { tool: InlineToolData; cc: string }) {
  const argsRaw = formatArgsRaw(tool);
  const resultText = formatResult(tool);

  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${cc}15` }}>
      {argsRaw && (
        <>
          <Label>Args</Label>
          <Pre>{argsRaw.slice(0, 2000)}</Pre>
        </>
      )}
      {resultText && (
        <>
          <Label>{tool.status === 'error' ? 'Error' : 'Result'}</Label>
          <Pre>{resultText.slice(0, 4000)}</Pre>
        </>
      )}
    </Box>
  );
}

function formatResult(tool: InlineToolData): string {
  const result = tool.result;
  if (!result) return '';

  if (tool.status === 'error') return result.replace(/^error/i, '').trim();

  let text = result;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object') {
      text = parsed.output || parsed.message || parsed.result || JSON.stringify(parsed, null, 2);
    }
  } catch {}
  return String(text).trim();
}

function formatArgsRaw(tool: InlineToolData): string | null {
  if (!tool.args) return null;
  const parsed = typeof tool.args === 'string' ? (() => { try { return JSON.parse(tool.args) as Record<string, unknown>; } catch { return {}; } })() : tool.args;
  const keys = Object.keys(parsed);
  if (keys.length === 0) return null;
  return JSON.stringify(parsed, null, 2);
}

function Label({ children }: { children: string }) {
  return (
    <Typography sx={{
      fontSize: '0.5rem', fontWeight: 600, color: colors.text.dim,
      fontFamily: "'JetBrains Mono', monospace", mb: 0.25, mt: 0.5,
      textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {children}
    </Typography>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <Box sx={{
      bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75,
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
      color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
      maxHeight: 300, overflow: 'auto', wordBreak: 'break-word',
    }}>
      {children}
    </Box>
  );
}
