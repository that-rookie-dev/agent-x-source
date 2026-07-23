import { useState, useEffect, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { getToolDisplay } from './tool-display';

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

function InlineToolCallComponent({ tool, compactTop }: { tool: InlineToolData; compactTop?: boolean }) {
  const display = getToolDisplay(tool.name, tool.args);
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  const [liveElapsed, setLiveElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning) { setLiveElapsed(0); return; }
    const start = Date.now();
    const timer = setInterval(() => setLiveElapsed(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [isRunning, tool.id]);

  const label = display.subtitle ? `${display.title}: ${display.subtitle}` : display.title;

  return (
    <Box sx={{ mb: 0.25, mt: compactTop ? -0.625 : 0 }}>
      <Typography sx={{
        display: 'inline',
        fontSize: '0.68rem',
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '0.02em',
        color: isRunning ? colors.text.secondary : colors.text.dim,
        fontWeight: isRunning ? 600 : 400,
        textDecoration: isError ? 'line-through' : 'none',
        ...(isRunning ? { animation: 'agentx-pulse 1.4s ease-in-out infinite' } : {}),
      }}>
        {label}
      </Typography>

      {isRunning && (
        <Box sx={{ mt: 0.25, pl: 0 }}>
          <Typography sx={{
            fontSize: '0.55rem',
            color: colors.text.dim,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {tool.streamOutput?.trim()
              ? tool.streamOutput.trimEnd().split('\n').slice(-4).join('\n')
              : `Running for ${liveElapsed >= 1000 ? (liveElapsed / 1000).toFixed(1) + 's' : liveElapsed + 'ms'}…`}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function inlineToolPropsEqual(
  prev: { tool: InlineToolData; compactTop?: boolean },
  next: { tool: InlineToolData; compactTop?: boolean },
): boolean {
  if (prev.compactTop !== next.compactTop) return false;
  const a = prev.tool;
  const b = next.tool;
  return a.id === b.id
    && a.name === b.name
    && a.status === b.status
    && a.result === b.result
    && a.streamOutput === b.streamOutput
    && a.elapsed === b.elapsed
    && a.args === b.args
    && a.metadata === b.metadata;
}

export const InlineToolCall = memo(InlineToolCallComponent, inlineToolPropsEqual);
