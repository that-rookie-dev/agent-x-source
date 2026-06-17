import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import type { InlineToolData } from './InlineToolCall';

// ─── Specialized renderers for specific tool types ───

export function ShellRender({ tool }: { tool: InlineToolData }) {
  const args = tool.args;
  const command = typeof args === 'object' && args !== null
    ? String((args as Record<string, unknown>).command || (args as Record<string, unknown>).description || '')
    : '';
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.green}15` }}>
      {command && (
        <>
          <Label>Command</Label>
          <Box sx={{
            bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, mb: 0.5,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: colors.accent.green, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            $ {command}
          </Box>
        </>
      )}
      {tool.result && (
        <>
          <Label>Output</Label>
          <Box sx={{
            bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            maxHeight: 300, overflow: 'auto', wordBreak: 'break-word',
          }}>
            {cleanResult(tool.result).slice(0, 4000)}
          </Box>
        </>
      )}
    </Box>
  );
}

export function ReadRender({ tool }: { tool: InlineToolData }) {
  const args = tool.args;
  const path = typeof args === 'object' && args !== null
    ? String((args as Record<string, unknown>).path || (args as Record<string, unknown>).filePath || '')
    : '';
  const result = cleanResult(tool.result);
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.blue}15` }}>
      {path && <Label>File</Label>}
      {path && (
        <Box sx={{
          bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, mb: result ? 0.5 : 0,
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
          color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {path}
        </Box>
      )}
      {result && (
        <>
          <Label>Content</Label>
          <Box sx={{
            bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            maxHeight: 300, overflow: 'auto', wordBreak: 'break-word',
          }}>
            {result.slice(0, 4000)}
          </Box>
        </>
      )}
    </Box>
  );
}

export function EditRender({ tool }: { tool: InlineToolData }) {
  const args = tool.args;
  const path = typeof args === 'object' && args !== null
    ? String((args as Record<string, unknown>).path || (args as Record<string, unknown>).filePath || '')
    : '';
  const result = cleanResult(tool.result);
  const isDiff = result.includes('---') && result.includes('+++');
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.orange}15` }}>
      {path && <Label>File</Label>}
      {path && (
        <Box sx={{
          bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, mb: result ? 0.5 : 0,
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
          color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {path}
        </Box>
      )}
      {result && (
        <>
          <Label>{isDiff ? 'Diff' : 'Result'}</Label>
          <Box sx={{
            bgcolor: isDiff ? '#1a0a00' : '#0a0a0a', borderRadius: 0.5, p: 0.75,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: isDiff ? colors.accent.orange : colors.text.secondary,
            lineHeight: 1.5, whiteSpace: 'pre-wrap',
            maxHeight: 300, overflow: 'auto', wordBreak: 'break-word',
          }}>
            {result.slice(0, 4000)}
          </Box>
        </>
      )}
    </Box>
  );
}

export function GlobRender({ tool }: { tool: InlineToolData }) {
  const args = tool.args;
  const pattern = typeof args === 'object' && args !== null
    ? String((args as Record<string, unknown>).pattern || '')
    : '';
  const result = cleanResult(tool.result);
  const files = result ? result.split('\n').filter(Boolean) : [];
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.purple}15` }}>
      {pattern && <Label>Pattern</Label>}
      {pattern && (
        <Box sx={{
          bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, mb: result ? 0.5 : 0,
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
          color: colors.accent.purple, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {pattern}
        </Box>
      )}
      {files.length > 0 && (
        <>
          <Label>Files ({files.length})</Label>
          <Box sx={{
            bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: colors.text.secondary, lineHeight: 1.5,
            maxHeight: 300, overflow: 'auto',
          }}>
            {files.slice(0, 50).map((f, i) => (
              <Box key={i} sx={{ py: 0.15, '&:hover': { color: colors.text.primary } }}>
                {f}
              </Box>
            ))}
            {files.length > 50 && (
              <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, mt: 0.5 }}>
                ... and {files.length - 50} more
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}

export function GrepRender({ tool }: { tool: InlineToolData }) {
  const args = tool.args;
  const pattern = typeof args === 'object' && args !== null
    ? String((args as Record<string, unknown>).pattern || '')
    : '';
  const result = cleanResult(tool.result);
  const lines = result ? result.split('\n').filter(Boolean) : [];
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.cyan}15` }}>
      {pattern && <Label>Pattern</Label>}
      {pattern && (
        <Box sx={{
          bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, mb: result ? 0.5 : 0,
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
          color: colors.accent.cyan, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {pattern}
        </Box>
      )}
      {lines.length > 0 && (
        <>
          <Label>Matches ({lines.length})</Label>
          <Box sx={{
            bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            maxHeight: 300, overflow: 'auto',
          }}>
            {lines.slice(0, 50).join('\n')}
            {lines.length > 50 && (
              <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, mt: 0.5 }}>
                ... and {lines.length - 50} more lines
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}

export function TaskRender({ tool }: { tool: InlineToolData }) {
  const result = cleanResult(tool.result);
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.purple}15` }}>
      {result && (
        <>
          <Label>Result</Label>
          <Box sx={{
            bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75,
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            maxHeight: 300, overflow: 'auto', wordBreak: 'break-word',
          }}>
            {result.slice(0, 4000)}
          </Box>
        </>
      )}
    </Box>
  );
}

// ─── Helpers ───

function Label({ children }: { children: ReactNode }) {
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

function cleanResult(result: string | undefined): string {
  if (!result) return '';
  let text = result;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object') {
      text = parsed.output || parsed.message || parsed.result || JSON.stringify(parsed, null, 2);
    }
  } catch {}
  return String(text).trim();
}
