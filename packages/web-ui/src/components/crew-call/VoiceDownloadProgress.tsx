import { useEffect, useState, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import DownloadIcon from '@mui/icons-material/Download';
import type { TelemetryEvent } from '../../api';
import type { DownloadProgress } from '@agentx/shared/browser';
import { parseDownloadProgressLine, downloadResultFromMetadata } from '@agentx/shared/browser';
import { subscribeOptimizedTelemetry } from '../../perf/optimized-telemetry';
import { colors, alphaColor } from '../../theme';

function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ActiveDownload {
  callId: string;
  filename: string;
  progress?: DownloadProgress;
  result?: { filename: string; size: number };
  running: boolean;
}

export function VoiceDownloadProgress({ sessionId }: { sessionId?: string | null }) {
  const [active, setActive] = useState<ActiveDownload[]>([]);
  const activeRef = useRef<Map<string, ActiveDownload>>(new Map());

  useEffect(() => {
    if (!sessionId) return;
    const flush = () => {
      setActive(Array.from(activeRef.current.values()).filter((d) => d.running));
    };
    const unsubscribe = subscribeOptimizedTelemetry((ev: TelemetryEvent) => {
      const e = ev as Record<string, unknown>;
      if ((e.sessionId as string) !== sessionId) return;
      if (e.type !== 'tool_output' && e.type !== 'tool_complete') return;
      const toolName = (e.tool as string) ?? '';
      if (toolName !== 'http_download') return;
      const callId = (e.callId as string) ?? '';
      if (!callId) return;

      if (e.type === 'tool_output') {
        const output = (e.output as string) ?? '';
        const progress = parseDownloadProgressLine(output.trim());
        if (progress) {
          const filename = progress.outputPath ? progress.outputPath.split('/').pop() ?? progress.outputPath : 'download';
          const current = activeRef.current.get(callId);
          activeRef.current.set(callId, {
            callId,
            filename: current?.filename ?? filename,
            progress,
            result: current?.result,
            running: progress.phase !== 'done' && progress.phase !== 'error',
          });
          flush();
        }
      } else if (e.type === 'tool_complete') {
        const meta = e.metadata as Record<string, unknown> | undefined;
        const result = downloadResultFromMetadata(meta);
        const progress = meta?.downloadProgress as DownloadProgress | undefined;
        if (result || progress) {
          const filename = result?.filename ?? progress?.outputPath?.split('/').pop() ?? 'download';
          activeRef.current.set(callId, {
            callId,
            filename,
            progress,
            result: result ? { filename: result.filename, size: result.size } : undefined,
            running: result ? false : progress?.phase !== 'done' && progress?.phase !== 'error',
          });
          flush();
        }
        // Remove completed after a short delay so the user sees the 100% bar briefly.
        if (!activeRef.current.get(callId)?.running) {
          setTimeout(() => {
            activeRef.current.delete(callId);
            flush();
          }, 2500);
        }
      }
    });
    return unsubscribe;
  }, [sessionId]);

  if (!active.length) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 38,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        pointerEvents: 'none',
      }}
    >
      {active.map((d) => {
        const percent = d.progress?.percent ?? (d.result ? 100 : undefined);
        const total = d.progress?.totalBytes ?? d.result?.size;
        const downloaded = d.progress?.downloadedBytes ?? d.result?.size;
        return (
          <Box
            key={d.callId}
            sx={{
              bgcolor: alphaColor(colors.bg.tertiary, 0.72),
              border: `1px solid ${colors.border.default}`,
              borderRadius: '5px',
              px: 0.75,
              py: 0.4,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              backdropFilter: 'blur(2px)',
            }}
          >
            <DownloadIcon sx={{ fontSize: 13, color: colors.accent.cyan, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.52rem',
                  color: colors.text.primary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {d.filename}
              </Typography>
              <LinearProgress
                variant={percent != null ? 'determinate' : 'indeterminate'}
                value={percent ?? 0}
                sx={{
                  height: 3,
                  borderRadius: '2px',
                  mt: 0.25,
                  bgcolor: alphaColor(colors.accent.cyan, 0.15),
                  '& .MuiLinearProgress-bar': { bgcolor: colors.accent.cyan },
                }}
              />
            </Box>
            <Typography
              sx={{
                fontSize: '0.48rem',
                color: colors.text.dim,
                whiteSpace: 'nowrap',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {typeof downloaded === 'number' ? formatBytes(downloaded) : ''}
              {typeof total === 'number' ? ` / ${formatBytes(total)}` : ''}
              {typeof percent === 'number' ? ` · ${percent}%` : ''}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
