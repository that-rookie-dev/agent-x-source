import type { VoiceAssetCatalogEntry, VoiceComputeDevice, VoiceConfig, VoiceDownloadedAsset } from '@agentx/shared';

export const DEFAULT_VOICE_CONFIG: Required<Pick<VoiceConfig, 'enabled' | 'mode' | 'stt' | 'tts' | 'sidecar' | 'fillers' | 'downloadedAssets'>> = {
  enabled: false,
  mode: {
    web: 'off',
    channels: 'off',
  },
  stt: {
    engine: 'faster-whisper',
    modelId: 'faster-whisper-base.en',
    computeType: 'int8',
    device: 'auto',
  },
  tts: {
    engine: 'kokoro',
    voiceId: 'kokoro-af',
    fillerEngine: 'kokoro',
  },
  sidecar: {
    autoStart: false,
    idleUnloadMinutes: 5,
  },
  fillers: {
    enabled: true,
    speakToolProgress: true,
  },
  downloadedAssets: [],
};

export const VOICE_ASSET_CATALOG: VoiceAssetCatalogEntry[] = [
  {
    id: 'faster-whisper-tiny.en',
    kind: 'stt-model',
    engine: 'faster-whisper',
    displayName: 'faster-whisper tiny.en',
    description: 'Smallest English STT model for low-resource devices and fastest transcription.',
    sizeMB: 75,
    downloadUrl: 'hf://Systran/faster-whisper-tiny.en',
    license: 'MIT',
  },
  {
    id: 'faster-whisper-base.en',
    kind: 'stt-model',
    engine: 'faster-whisper',
    displayName: 'faster-whisper base.en',
    description: 'Recommended English STT model balancing accuracy and latency.',
    sizeMB: 145,
    downloadUrl: 'hf://Systran/faster-whisper-base.en',
    deliveryTier: 'download',
    license: 'MIT',
    recommended: true,
  },
  {
    id: 'faster-whisper-small.en',
    kind: 'stt-model',
    engine: 'faster-whisper',
    displayName: 'faster-whisper small.en',
    description: 'Higher-accuracy English STT model with a larger memory and latency footprint.',
    sizeMB: 465,
    downloadUrl: 'hf://Systran/faster-whisper-small.en',
    license: 'MIT',
  },
  {
    id: 'kokoro-82m',
    kind: 'tts-model',
    engine: 'kokoro',
    displayName: 'Kokoro 82M',
    description: 'Fast, natural local TTS model. Also used for low-latency spoken fillers.',
    sizeMB: 330,
    downloadUrl: 'hf://hexgrad/Kokoro-82M',
    deliveryTier: 'download',
    license: 'Apache-2.0',
    recommended: true,
  },
  {
    id: 'kokoro-af',
    kind: 'tts-voice',
    engine: 'kokoro',
    displayName: 'Kokoro AF Voice',
    description: 'Default English Kokoro voice for final replies and progress fillers.',
    sizeMB: 1,
    downloadUrl: 'hf://hexgrad/Kokoro-82M',
    deliveryTier: 'download',
    license: 'Apache-2.0',
    recommended: true,
  },
  {
    id: 'silero-vad',
    kind: 'vad-model',
    displayName: 'Silero VAD',
    description: 'Voice activity detection for turn endpointing and barge-in.',
    sizeMB: 3,
    downloadUrl: 'github://snakers4/silero-vad',
    deliveryTier: 'bundled',
    license: 'MIT',
    recommended: true,
  },
];

export function mergeVoiceConfig(input?: VoiceConfig | null): VoiceConfig {
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...input,
    mode: { ...DEFAULT_VOICE_CONFIG.mode, ...input?.mode },
    stt: { ...DEFAULT_VOICE_CONFIG.stt, ...input?.stt },
    tts: { ...DEFAULT_VOICE_CONFIG.tts, ...input?.tts },
    sidecar: { ...DEFAULT_VOICE_CONFIG.sidecar, ...input?.sidecar },
    fillers: { ...DEFAULT_VOICE_CONFIG.fillers, ...input?.fillers },
    downloadedAssets: input?.downloadedAssets ?? [],
  };
}

export function isVoiceAssetInstalled(config: VoiceConfig | undefined | null, assetId: string): boolean {
  return Boolean(config?.downloadedAssets?.some((asset) => asset.assetId === assetId));
}

export function addVoiceDownloadedAsset(config: VoiceConfig | undefined | null, asset: VoiceDownloadedAsset): VoiceConfig {
  const merged = mergeVoiceConfig(config);
  return {
    ...merged,
    downloadedAssets: [
      ...(merged.downloadedAssets ?? []).filter((entry) => entry.assetId !== asset.assetId),
      asset,
    ],
  };
}

export function recommendedVoiceComputeDevice(hasCuda: boolean): VoiceComputeDevice {
  return hasCuda ? 'cuda' : 'cpu';
}
