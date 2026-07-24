/**
 * Neural Cortex step for the setup wizard.
 *
 * Progress-only: auto-starts embedding download with RAM-tier messaging.
 * Continue / Skip live in the wizard bottom nav (not inside this card).
 */
import Box from '@mui/material/Box';
import { resolveNeuralCortexEmbeddingTier } from '@agentx/shared/browser';
import { EmbeddingModelDownload } from '../EmbeddingModelDownload';
import { WizardStepHeader } from './wizard-ui';

export interface WizardNeuralStepProps {
  /** Total system RAM in GB (for tier resolution). */
  totalMemoryGB?: number;
  /** Fired when download completes (or was already complete). */
  onReadyChange?: (ready: boolean) => void;
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

export function WizardNeuralStep({ totalMemoryGB, onReadyChange }: WizardNeuralStepProps) {
  const tier = resolveNeuralCortexEmbeddingTier(totalMemoryGB ?? 0);
  const copy = TIER_COPY[tier];

  return (
    <Box>
      <WizardStepHeader
        codename="MODULE · NEURAL CORTEX"
        title="Neural Cortex Initialization"
        subtitle={copy.subtitle}
      />

      <EmbeddingModelDownload
        onReadyChange={onReadyChange}
        banner={tier === 'minilm' && 'headline' in copy
          ? { headline: copy.headline, body: copy.body }
          : undefined}
      />
    </Box>
  );
}
