
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import { colors } from '../theme';

export interface ActiveDownload {
  modelId: string;
  displayName: string;
  sizeGB: number;
  progress: number;
  status: 'downloading' | 'complete' | 'error';
  error?: string;
  startTime: number;
}

interface DownloadIndicatorProps {
  downloads: ActiveDownload[];
  onClear: (modelId: string) => void;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 10px',
    borderRadius: 16,
    border: `1px solid ${colors.border.default}`,
    backgroundColor: colors.bg.secondary,
    cursor: 'pointer',
  },
  icon: {
    fontSize: 18,
  },
  tooltip: {
    padding: 12,
    maxWidth: 320,
    backgroundColor: colors.bg.secondary,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 8,
  },
  downloadRow: {
    marginBottom: 10,
  },
  downloadRowLast: {
    marginBottom: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modelName: {
    fontSize: '0.78rem',
    fontWeight: 600,
    fontFamily: '"JetBrains Mono", monospace',
  },
  sizeText: {
    fontSize: '0.65rem',
    color: colors.text.dim,
    fontFamily: '"JetBrains Mono", monospace',
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginBottom: 4,
    overflow: 'hidden',
  },
  progressText: {
    fontSize: '0.65rem',
    color: colors.text.dim,
    fontFamily: '"JetBrains Mono", monospace',
  },
  errorText: {
    fontSize: '0.7rem',
    color: '#ff4d4d',
    marginBottom: 4,
  },
  successText: {
    fontSize: '0.7rem',
    color: '#4dff88',
  },
  clearButton: {
    fontSize: '0.6rem',
    fontFamily: '"JetBrains Mono", monospace',
    textTransform: 'none',
    color: colors.text.dim,
    padding: '2px 6px',
    border: `1px solid ${colors.border.default}`,
    borderRadius: 4,
  },
  summary: {
    fontSize: '0.7rem',
    color: colors.text.secondary,
    fontFamily: '"JetBrains Mono", monospace',
  },
};

function getProgressFillStyle(progress: number, color: string): React.CSSProperties {
  return { height: '100%', backgroundColor: color, width: `${progress}%`, transition: 'width 0.3s' };
}

function DownloadTooltip({ downloads, onClear }: DownloadIndicatorProps) {
  return (
    <Box style={styles.tooltip}>
      {downloads.map((dl, index) => {
        const isLast = index === downloads.length - 1;
        const downloadedGB = (dl.sizeGB * dl.progress) / 100;

        return (
          <Box key={dl.modelId} style={isLast ? styles.downloadRowLast : styles.downloadRow}>
            <Box style={styles.header}>
              <Typography style={styles.modelName}>{dl.displayName}</Typography>
              {dl.status === 'complete' && (
                <IconButton size="small" onClick={() => onClear(dl.modelId)} sx={{ p: 0.3, color: colors.text.dim }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              )}
              {dl.status === 'error' && (
                <button
                  onClick={() => onClear(dl.modelId)}
                  style={styles.clearButton}
                >
                  Clear
                </button>
              )}
            </Box>

            {dl.status === 'downloading' && (
              <>
                <Box style={styles.progressBar}>
                  <Box style={getProgressFillStyle(dl.progress, '#4da6ff')} />
                </Box>
                <Typography style={styles.progressText}>
                  {downloadedGB.toFixed(2)} / {dl.sizeGB} GB ({dl.progress}%)
                </Typography>
              </>
            )}

            {dl.status === 'complete' && (
              <Typography style={styles.successText}>✓ Downloaded ({dl.sizeGB} GB)</Typography>
            )}

            {dl.status === 'error' && (
              <Typography style={styles.errorText}>
                ✗ {dl.error || 'Download failed'}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function DownloadIndicator({ downloads, onClear }: DownloadIndicatorProps) {
  if (downloads.length === 0) return null;

  const hasActive = downloads.some(d => d.status === 'downloading');
  const hasError = downloads.some(d => d.status === 'error');

  // Priority: active > error > complete
  const status = hasActive ? 'downloading' : hasError ? 'error' : 'complete';
  const activeDownloads = downloads.filter(d => d.status === 'downloading');
  const totalProgress = activeDownloads.length > 0
    ? Math.round(activeDownloads.reduce((sum, d) => sum + d.progress, 0) / activeDownloads.length)
    : 0;

  const iconColor = status === 'downloading' ? '#4da6ff' : status === 'error' ? '#ff4d4d' : '#4dff88';
  const Icon = status === 'downloading' ? DownloadIcon : status === 'error' ? ErrorIcon : CheckCircleIcon;

  return (
    <Tooltip
      title={<DownloadTooltip downloads={downloads} onClear={onClear} />}
      placement="top"
      arrow
      enterTouchDelay={0}
      leaveTouchDelay={3000}
    >
      <Box style={styles.container}>
        <Icon
          sx={{
            ...styles.icon,
            color: iconColor,
            animation: status === 'downloading' ? 'pulse 1.5s ease-in-out infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.4 },
            },
          }}
        />
        <Typography style={styles.summary}>
          {status === 'downloading' ? `${totalProgress}%` : downloads.length}
        </Typography>
      </Box>
    </Tooltip>
  );
}
