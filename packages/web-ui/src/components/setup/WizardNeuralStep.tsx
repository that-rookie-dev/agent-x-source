/**
 * Neural Core step for the setup wizard.
 *
 * On 16GB+ systems: renders EmbeddingModelDownload directly.
 * On low-RAM systems: shows a warning panel with an opt-in checkbox
 * and a confirmation modal before enabling the download.
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import { EmbeddingModelDownload } from '../EmbeddingModelDownload';
import { WizardStepHeader } from './wizard-ui';
import {
  wizardPanelSx,
  wizardPrimaryBtnSx,
  wizardSkipBtnSx,
  wizardTheme,
  WIZARD_MONO,
} from './wizard-theme';

export interface WizardNeuralStepProps {
  /** True if the system has enough RAM (>=16GB) for the neural brain. */
  neuralBrainSupported: boolean;
  /** Total system RAM in GB (for display). */
  totalMemoryGB?: number;
  /**
   * Called when the user proceeds past this step.
   * `enabled` indicates whether the user wants the neural brain enabled.
   */
  onComplete: (enabled: boolean) => void;
}

export function WizardNeuralStep({ neuralBrainSupported, totalMemoryGB, onComplete }: WizardNeuralStepProps) {
  const [optedIn, setOptedIn] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);

  const headerEl = (
    <WizardStepHeader
      codename="MODULE · NEURAL CORE"
      title="Neural Core Initialization"
      subtitle="Local embedding models for offline semantic search and GraphRAG."
    />
  );

  // Compatible systems: render the download directly. onComplete means enabled,
  // onSkip means the user chose to disable the neural core.
  if (neuralBrainSupported) {
    return (
      <Box>
        {headerEl}
        <EmbeddingModelDownload onComplete={() => onComplete(true)} onSkip={() => onComplete(false)} />
      </Box>
    );
  }

  // Low-RAM system, user has opted in: render the download.
  if (optedIn) {
    return (
      <Box>
        {headerEl}
        <EmbeddingModelDownload onComplete={() => onComplete(true)} onSkip={() => onComplete(false)} forceEnabled />
      </Box>
    );
  }

  // Low-RAM system, not yet opted in: show warning + opt-in.
  return (
    <Box>
      {headerEl}

      {/* Warning panel — matches wizardPanelSx with an orange left accent border */}
      <Box sx={{
        ...wizardPanelSx,
        borderLeft: `3px solid ${wizardTheme.accentWarn}`,
        mb: 2,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Typography sx={{
            fontFamily: WIZARD_MONO,
            fontSize: '0.52rem',
            letterSpacing: '2px',
            color: wizardTheme.accentWarn,
            textTransform: 'uppercase',
            fontWeight: 700,
          }}>
            Performance Warning · Low-RAM System
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.72rem', color: wizardTheme.textSecondary, lineHeight: 1.6, mb: 1.5 }}>
          Your system has {totalMemoryGB?.toFixed(1) ?? 'less than 16'} GB of RAM. The neural brain
          requires at least 16 GB for stable operation. Running it on this machine may cause:
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1.5 }}>
          {[
            'Slow response times and high memory pressure',
            'Application freezes or unresponsive UI',
            'Potential crashes during embedding model inference',
          ].map((item) => (
            <Box key={item} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.6rem', color: wizardTheme.accentWarn, fontFamily: WIZARD_MONO }}>⚠</Typography>
              <Typography sx={{ fontSize: '0.68rem', color: wizardTheme.textSecondary, lineHeight: 1.45 }}>{item}</Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: '0.65rem', color: wizardTheme.textDim, lineHeight: 1.5 }}>
          You can skip this step — Agent-X works fully without the neural brain. Chat, crews, and all
          other features remain available.
        </Typography>
      </Box>

      {/* Opt-in checkbox */}
      <FormControlLabel
        control={
          <Checkbox
            checked={optedIn}
            onChange={(_, checked) => {
              if (checked) setWarningOpen(true);
              else setOptedIn(false);
            }}
            size="small"
            sx={{ color: wizardTheme.accentWarn, '&.Mui-checked': { color: wizardTheme.accentWarn } }}
          />
        }
        label={
          <Typography sx={{ fontSize: '0.68rem', color: wizardTheme.textSecondary, fontFamily: WIZARD_MONO }}>
            I understand the risks — enable neural brain on this system
          </Typography>
        }
        sx={{ mt: 0.5, mb: 2 }}
      />

      {/* Skip button */}
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Button onClick={() => onComplete(false)} sx={wizardSkipBtnSx}>
          Skip Neural Core →
        </Button>
      </Box>

      {/* Confirmation modal — matches existing wizard dialog style */}
      <Dialog
        open={warningOpen}
        onClose={() => setWarningOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: wizardTheme.panel,
            border: `1px solid ${wizardTheme.panelBorder}`,
            borderRadius: 1,
            maxWidth: 440,
          },
        }}
      >
        <DialogTitle sx={{
          fontFamily: WIZARD_MONO,
          fontSize: '0.85rem',
          fontWeight: 700,
          color: wizardTheme.text,
          pb: 1,
        }}>
          CONFIRM NEURAL BRAIN ENABLEMENT
        </DialogTitle>
        <DialogContent>
          <Box sx={{
            ...wizardPanelSx,
            borderLeft: `3px solid ${wizardTheme.accentWarn}`,
            mb: 2,
          }}>
            <Typography sx={{ fontSize: '0.75rem', color: wizardTheme.textSecondary, lineHeight: 1.6, mb: 1 }}>
              You are about to enable the neural brain on a system with {totalMemoryGB?.toFixed(1) ?? 'less than 16'} GB of RAM.
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: wizardTheme.textSecondary, lineHeight: 1.6 }}>
              This may severely affect system performance. The application may become unresponsive,
              freeze, or crash during embedding model operations.
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.72rem', color: wizardTheme.textDim, lineHeight: 1.5 }}>
            If you experience issues, you can disable the neural brain later in Settings → Neural.
            Are you sure you want to proceed?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setWarningOpen(false)} sx={wizardSkipBtnSx}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setWarningOpen(false);
              setOptedIn(true);
            }}
            variant="contained"
            sx={wizardPrimaryBtnSx}
          >
            Enable Neural Brain
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
