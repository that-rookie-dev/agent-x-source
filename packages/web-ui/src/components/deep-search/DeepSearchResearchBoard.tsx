import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import DashboardIcon from '@mui/icons-material/Dashboard';
import type { DeepSearchResultBundle } from '@agentx/shared/browser';
import { colors, alphaColor } from '../../theme';
import { DeepSearchResultCard } from './DeepSearchResultCard';
import { searchResultsRowSx, deepSearchShellSx } from './card-utils';
import { formatSearchProvidersList } from './provider-labels';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 64 }}>
      <Typography sx={{
        fontSize: '0.48rem',
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        color: colors.text.dim,
        mb: 0.15,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: '0.62rem',
        color: colors.text.primary,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1.3,
      }}>
        {value}
      </Typography>
    </Box>
  );
}

export function DeepSearchResearchBoard({
  bundle,
  open,
  onClose,
}: {
  bundle: DeepSearchResultBundle;
  open: boolean;
  onClose: () => void;
}) {
  const providersLabel = formatSearchProvidersList(bundle);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          ...deepSearchShellSx,
          backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{
        px: 1,
        py: 0.55,
        borderBottom: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 0.75,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          <DashboardIcon sx={{ fontSize: 14, color: colors.accent.cyan, flexShrink: 0 }} />
          <Typography sx={{
            fontSize: '0.58rem',
            fontWeight: 700,
            letterSpacing: '0.8px',
            fontFamily: "'JetBrains Mono', monospace",
            color: colors.accent.cyan,
          }}>
            RESEARCH BOARD
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{
            fontSize: '0.5rem',
            color: colors.text.dim,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {bundle.stats.kept} kept · {bundle.stats.searched} scanned · {(bundle.stats.ms / 1000).toFixed(1)}s
          </Typography>
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.35 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{
        px: 1,
        py: 0.5,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <Typography sx={{
          fontSize: '0.62rem',
          color: colors.text.secondary,
          fontStyle: 'italic',
          lineHeight: 1.35,
        }}>
          “{bundle.query}”
        </Typography>
        {bundle.plan.intent.length > 0 && (
          <Typography sx={{
            fontSize: '0.5rem',
            color: colors.text.dim,
            mt: 0.2,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Intent: {bundle.plan.intent.join(', ')}
          </Typography>
        )}
      </Box>

      <Box sx={{
        px: 1,
        py: 0.55,
        borderBottom: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        bgcolor: `${alphaColor(colors.accent.blue, '06')}`,
      }}>
        <Stat label="Kept" value={String(bundle.stats.kept)} />
        <Stat label="Scanned" value={String(bundle.stats.searched)} />
        <Stat label="Fetched" value={String(bundle.stats.fetched)} />
        <Stat label="Time" value={`${(bundle.stats.ms / 1000).toFixed(1)}s`} />
        {bundle.plan.intent.length > 0 && (
          <Stat label="Intent" value={bundle.plan.intent.join(', ')} />
        )}
        {providersLabel && (
          <Stat label="Providers" value={providersLabel} />
        )}
      </Box>

      <Box sx={searchResultsRowSx}>
        {bundle.results.map((result, i) => (
          <DeepSearchResultCard key={result.id} result={result} rank={i + 1} />
        ))}
      </Box>
    </Dialog>
  );
}

export function ResearchBoardTrigger({
  bundle,
}: {
  bundle: DeepSearchResultBundle;
}) {
  const [open, setOpen] = useState(false);
  if (bundle.results.length === 0) return null;

  return (
    <>
      <Button
        size="small"
        onClick={() => setOpen(true)}
        startIcon={<DashboardIcon sx={{ fontSize: 14 }} />}
        sx={{
          fontSize: '0.58rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.accent.cyan,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          minWidth: 0,
          py: 0.25,
        }}
      >
        Research board
      </Button>
      <DeepSearchResearchBoard bundle={bundle} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
