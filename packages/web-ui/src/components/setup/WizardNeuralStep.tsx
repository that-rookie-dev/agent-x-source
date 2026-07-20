/**
 * Neural Cortex step for the setup wizard.
 *
 * Progress-only: auto-starts embedding download with RAM-tier messaging.
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { resolveNeuralCortexEmbeddingTier } from '@agentx/shared/browser';
import { EmbeddingModelDownload } from '../EmbeddingModelDownload';
import { WizardStepHeader } from './wizard-ui';
import { wizardPanelSx, wizardTheme, WIZARD_MONO } from './wizard-theme';

export interface WizardNeuralStepProps {
  /** Total system RAM in GB (for tier resolution). */
  totalMemoryGB?: number;
  /** Called when the user proceeds past this step. */
  onComplete: () => void;
}

const TIER_COPY = {
  'bge-m3': {
    subtitle: 'Awakening the full neural core for this vessel.',
  },
  minilm: {
    subtitle: 'Bringing the neural core online for this voyage.',
    headline: 'Standard Neural Link',
    body: 'Your agent is ready to serve. On a more capable platform, Agent-X will reach even greater heights.',
  },
} as const;

export function WizardNeuralStep({ totalMemoryGB, onComplete }: WizardNeuralStepProps) {
  const tier = resolveNeuralCortexEmbeddingTier(totalMemoryGB ?? 0);
  const copy = TIER_COPY[tier];

  return (
    <Box>
      <WizardStepHeader
        codename="MODULE · NEURAL CORTEX"
        title="Neural Cortex Initialization"
        subtitle={copy.subtitle}
      />

      {tier === 'minilm' && 'headline' in copy && (
        <Box sx={{
          ...wizardPanelSx,
          borderLeft: `3px solid ${wizardTheme.accentSignal}`,
          mb: 2,
        }}>
          <Typography sx={{
            fontFamily: WIZARD_MONO,
            fontSize: '0.52rem',
            letterSpacing: '2px',
            color: wizardTheme.accentSignal,
            textTransform: 'uppercase',
            fontWeight: 700,
            mb: 1,
          }}>
            {copy.headline}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: wizardTheme.textSecondary, lineHeight: 1.6 }}>
            {copy.body}
          </Typography>
        </Box>
      )}

      <EmbeddingModelDownload onComplete={onComplete} onSkip={onComplete} />
    </Box>
  );
}
