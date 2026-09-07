import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import DownloadIcon from '@mui/icons-material/Download';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { DownloadProgress, DownloadResult } from '@agentx/shared/browser';
import { colors, alphaColor } from '../theme';

function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DownloadMessageBlock({
  progress,
  result,
  running,
}: {
  progress?: DownloadProgress;
  result?: DownloadResult;
  running?: boolean;
}) {
  const isError = progress?.phase === 'error';
  const isDone = progress?.phase === 'done' || !!result;
  const filename = result?.filename ?? progress?.outputPath ?? 'download';
  const total = progress?.totalBytes ?? result?.size;
  const downloaded = progress?.downloadedBytes ?? result?.size;
  const percent = progress?.percent ?? (isDone ? 100 : undefined);

  const statusColor = isError ? colors.accent.red : isDone ? colors.accent.green : colors.accent.cyan;
  const StatusIcon = isError ? ErrorOutlineIcon : isDone ? InsertDriveFileIcon : DownloadIcon;

  return (
    <Box
      sx={{
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: '8px',
        overflow: 'hidden',
        bgcolor: alphaColor(colors.bg.elevated, 0.45),
        maxWidth: '560px',
      }}
    >
      <Box
        sx={{
          px: 1,
          py: 0.55,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}
      >
        <StatusIcon sx={{ fontSize: 16, color: statusColor, flexShrink: 0 }} />
        <Typography
          sx={{
            fontSize: '0.58rem',
            fontWeight: 700,
            letterSpacing: '0.6px',
            fontFamily: "'JetBrains Mono', monospace",
            color: statusColor,
            textTransform: 'uppercase',
          }}
        >
          {isError ? 'Download failed' : isDone ? 'Downloaded file' : 'Downloading file'}
        </Typography>
      </Box>

      <Box sx={{ px: 1, py: 0.75 }}>
        <Typography
          sx={{
            fontSize: '0.72rem',
            color: colors.text.primary,
            wordBreak: 'break-all',
            lineHeight: 1.35,
          }}
        >
          {filename}
        </Typography>
        {(progress?.message || result?.url) && (
          <Typography
            sx={{
              fontSize: '0.54rem',
              color: isError ? colors.accent.red : colors.text.secondary,
              mt: 0.25,
              lineHeight: 1.35,
            }}
          >
            {isError ? progress?.message : result?.url ?? progress?.message}
          </Typography>
        )}

        {!isError && (running || typeof percent === 'number') && (
          <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ flex: 1 }}>
              <LinearProgress
                variant={percent != null ? 'determinate' : 'indeterminate'}
                value={percent ?? 0}
                sx={{
                  height: 4,
                  borderRadius: '2px',
                  bgcolor: alphaColor(statusColor, 0.15),
                  '& .MuiLinearProgress-bar': { bgcolor: statusColor },
                }}
              />
            </Box>
            {typeof downloaded === 'number' && (
              <Typography
                sx={{
                  fontSize: '0.52rem',
                  color: colors.text.dim,
                  fontFamily: "'JetBrains Mono', monospace",
                  whiteSpace: 'nowrap',
                }}
              >
                {formatBytes(downloaded)}
                {typeof total === 'number' ? ` / ${formatBytes(total)}` : ''}
                {typeof percent === 'number' ? ` · ${percent}%` : ''}
              </Typography>
            )}
          </Box>
        )}

        {isDone && result && (
          <Typography
            sx={{
              fontSize: '0.52rem',
              color: colors.text.dim,
              fontFamily: "'JetBrains Mono', monospace",
              mt: 0.5,
            }}
          >
            {formatBytes(result.size)}
            {result.mimeType ? ` · ${result.mimeType}` : ''}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
