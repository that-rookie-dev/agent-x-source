import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  settingsBtnGhostSx,
  settingsHelperSx,
  settingsMonoSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { useVoiceAssetDownload } from '../../hooks/useVoiceAssetDownloads';

interface TtsModelRowProps {
  name: string;
  description: string;
  sizeMB: number;
  installed: boolean;
  isDefault: boolean;
  canSelect: boolean;
  downloadAssetId: string | null;
  onSelect: () => void;
  onDownload: (assetId: string) => void;
}

export function TtsModelRow({
  name,
  description,
  sizeMB,
  installed,
  isDefault,
  canSelect,
  downloadAssetId,
  onSelect,
  onDownload,
}: TtsModelRowProps) {
  const download = useVoiceAssetDownload(downloadAssetId);
  const isDownloading = download && (download.status === 'running' || download.status === 'pending' || download.status === 'verifying');
  const isDownloadError = download?.status === 'error';
  const isDownloadComplete = download?.status === 'complete' && !installed;

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 1.5,
      py: 1,
      borderBottom: `1px solid ${settingsTheme.border.default}`,
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', color: settingsTheme.text.primary }}>
            {name}
          </Typography>
          {installed && (
            <CheckCircleIcon sx={{ fontSize: 13, color: settingsTheme.accent.signal }} />
          )}
          {isDefault && (
            <Box sx={{
              ...settingsMonoSx,
              fontSize: '0.55rem',
              px: 0.5,
              py: 0.1,
              borderRadius: 0.5,
              bgcolor: `${settingsTheme.accent.hud}22`,
              color: settingsTheme.accent.hud,
              border: `1px solid ${settingsTheme.accent.hud}44`,
            }}>
              DEFAULT
            </Box>
          )}
        </Box>
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', mb: 0.25 }}>
          {description}
        </Typography>
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>
          {sizeMB} MB{installed ? ' · Installed' : ' · Not downloaded'}
        </Typography>

        {isDownloading && (
          <Box sx={{ mt: 0.75, mb: 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem' }}>
                {download.detail ?? 'Downloading…'}
              </Typography>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.6rem', color: settingsTheme.accent.hud }}>
                {Math.round(download.progress ?? 0)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={download.progress ?? 0}
              sx={{
                height: 3,
                borderRadius: 1,
                bgcolor: settingsTheme.border.default,
                '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.hud },
              }}
            />
            {download.downloadedMB != null && download.totalMB != null && (
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.55rem', color: settingsTheme.text.dim, mt: 0.25 }}>
                {download.downloadedMB} / {download.totalMB} MB
              </Typography>
            )}
          </Box>
        )}

        {isDownloadError && download?.error && (
          <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', color: settingsTheme.accent.alert, mt: 0.5 }}>
            {download.error}
          </Typography>
        )}
      </Box>

      <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
        {installed ? (
          <Button
            onClick={onSelect}
            disabled={isDefault || !canSelect}
            sx={{
              ...settingsBtnGhostSx,
              fontSize: '0.62rem',
              py: 0.3,
              px: 1,
              ...(isDefault ? { opacity: 0.5 } : {}),
            }}
          >
            {isDefault ? 'Selected' : 'Use'}
          </Button>
        ) : isDownloading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CircularProgress size={14} sx={{ color: settingsTheme.accent.hud }} />
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>
              {Math.round(download.progress ?? 0)}%
            </Typography>
          </Box>
        ) : isDownloadComplete ? (
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.accent.signal }}>
            Done
          </Typography>
        ) : (
          <Button
            onClick={() => { if (downloadAssetId) onDownload(downloadAssetId); }}
            disabled={!downloadAssetId}
            sx={{
              ...settingsBtnGhostSx,
              fontSize: '0.62rem',
              py: 0.3,
              px: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.3,
            }}
          >
            <DownloadIcon sx={{ fontSize: 13 }} />
            Download
          </Button>
        )}
      </Box>
    </Box>
  );
}
