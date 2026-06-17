import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { getToolDisplay, extractArgs } from './tool-display';

export interface InlineToolData {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
}

function getColor(status: string): string {
  if (status === 'running') return colors.accent.blue;
  if (status === 'error') return colors.accent.purple;
  return colors.accent.green;
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
  const parsed = extractArgs(tool.args);
  const keys = Object.keys(parsed);
  if (keys.length === 0) return null;
  return JSON.stringify(parsed, null, 2);
}

export function InlineToolCall({ tool }: { tool: InlineToolData }) {
  const [expanded, setExpanded] = useState(false);
  const cc = getColor(tool.status);
  const display = getToolDisplay(tool.name, tool.args);
  const headerRef = useRef<HTMLDivElement>(null);

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
  const details = !expanded || tool.status === 'running' ? null : (
    <DetailsPanel tool={tool} cc={cc} formatResult={formatResult} formatArgsRaw={formatArgsRaw} />
  );

  return (
    <Box sx={{
      mb: 0.5, borderRadius: 1, overflow: 'hidden',
      border: `1px solid ${cc}20`,
      bgcolor: `${cc}04`,
      transition: 'border-color 0.15s',
    }}>
      <Box
        ref={headerRef}
        onClick={() => tool.status !== 'running' && setExpanded(e => !e)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.625, py: 0.5, px: 1,
          opacity: tool.status === 'running' ? 0.7 : 1,
          cursor: tool.status === 'running' ? 'default' : 'pointer',
          '&:hover': tool.status !== 'running' ? { bgcolor: `${cc}08` } : {},
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

        {tool.status !== 'running' && (
          <Typography sx={{
            fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
            color: colors.text.dim, flexShrink: 0, transition: 'transform 0.15s',
            transform: expanded ? 'rotate(180deg)' : 'none',
          }}>
            ▾
          </Typography>
        )}
      </Box>

      {details}
    </Box>
  );
}

function DetailsPanel({ tool, cc, formatResult: fmtResult, formatArgsRaw: fmtArgs }: {
  tool: InlineToolData;
  cc: string;
  formatResult: (t: InlineToolData) => string;
  formatArgsRaw: (t: InlineToolData) => string | null;
}) {
  const argsRaw = fmtArgs(tool);
  const resultText = fmtResult(tool);

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
