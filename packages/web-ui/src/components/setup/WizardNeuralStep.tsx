/**
 * Neural Cortex step for the setup wizard.
 *
 * Auto-starts the embedding model and the SpeechBrain ECAPA voiceprint model
 * together. Both downloads share the same main progress UI.
 */
import { useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import { resolveNeuralCortexEmbeddingTier } from '@agentx/shared/browser';
import { EmbeddingModelDownload, type ModelProgressState } from '../EmbeddingModelDownload';
import { startVoiceAssetDownload, useVoiceAssetDownload } from '../../hooks/useVoiceAssetDownloads';
import { WizardStepHeader } from './wizard-ui';

export interface WizardNeuralStepProps {
  /** Total system RAM in GB (for tier resolution). */
  totalMemoryGB?: number;
  /** Fired when both the embedding model and the ECAPA voiceprint model are ready. */
  onReadyChange?: (ready: boolean) => void;
  /**
   * Fired when the download fails because the model is no longer available
   * from the endpoint. The wizard uses this to offer a "Continue without Neural Core" path
   * and silently leave the cortex in degraded mode.
   */
  onAvailabilityErrorChange?: (hasAvailabilityError: boolean) => void;
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

const ECAPA_ASSET_ID = 'speechbrain-ecapa';
const ECAPA_SIZE_MB = 45;

export function WizardNeuralStep({ totalMemoryGB, onReadyChange, onAvailabilityErrorChange }: WizardNeuralStepProps) {
  const tier = resolveNeuralCortexEmbeddingTier(totalMemoryGB ?? 0);
  const copy = TIER_COPY[tier];
  const ecapa = useVoiceAssetDownload(ECAPA_ASSET_ID);

  // Auto-start ECAPA download on mount if not already complete.
  useEffect(() => {
    if (ecapa?.status === 'not_started' || ecapa?.status === undefined) {
      void startVoiceAssetDownload(ECAPA_ASSET_ID);
    }
  }, [ecapa?.status]);

  const ecapaModel: ModelProgressState = useMemo(() => {
    const status = ecapa?.status ?? 'not_started';
    const isComplete = status === 'complete';
    const isError = status === 'error';
    const isDownloading = status === 'running' || status === 'pending' || status === 'verifying';
    const downloadedMB = ecapa?.downloadedMB ?? (isComplete ? ECAPA_SIZE_MB : 0);
    const totalMB = ecapa?.totalMB ?? ECAPA_SIZE_MB;
    const percentage = ecapa?.progress ?? (isComplete ? 100 : 0);

    return {
      id: ECAPA_ASSET_ID,
      displayName: 'SpeechBrain ECAPA',
      status: isComplete ? 'complete' : isError ? 'error' : isDownloading ? 'downloading' : 'pending',
      downloadedMB,
      totalMB,
      percentage,
      error: ecapa?.error,
      detail: ecapa?.detail,
    };
  }, [ecapa]);

  return (
    <Box>
      <WizardStepHeader
        codename="MODULE · NEURAL CORTEX"
        title="Neural Cortex Initialization"
        subtitle={copy.subtitle}
      />

      <EmbeddingModelDownload
        onReadyChange={onReadyChange}
        onAvailabilityErrorChange={onAvailabilityErrorChange}
        extraModels={[ecapaModel]}
        banner={tier === 'minilm' && 'headline' in copy
          ? { headline: copy.headline, body: copy.body }
          : undefined}
      />
    </Box>
  );
}
