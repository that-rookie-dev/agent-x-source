import type { VoiceAssetCatalogEntry, VoiceComputeDevice, VoiceConfig, VoiceDownloadedAsset } from '@agentx/shared';

export const DEFAULT_VOICE_CONFIG: Required<Pick<VoiceConfig, 'enabled' | 'mode' | 'stt' | 'tts' | 'sidecar' | 'fillers' | 'downloadedAssets'>> = {
  enabled: false,
  mode: {
    web: 'off',
    channels: 'off',
  },
  stt: {
    engine: 'faster-whisper',
    modelId: 'faster-distil-whisper-small.en',
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
    id: 'faster-distil-whisper-small.en',
    kind: 'stt-model',
    engine: 'faster-whisper',
    displayName: 'faster-distil-whisper small.en',
    description: 'Distilled Whisper small.en — 5.6x faster than base.en, within 1% WER. Recommended for duplex voice.',
    sizeMB: 166,
    downloadUrl: 'hf://Systran/faster-distil-whisper-small.en',
    deliveryTier: 'download',
    license: 'MIT',
    recommended: true,
  },
  {
    id: 'kokoro-onnx',
    kind: 'tts-model',
    engine: 'kokoro',
    displayName: 'Kokoro ONNX FP32',
    description: 'Kokoro 82M in ONNX format. 2-3x faster than PyTorch Kokoro, identical quality.',
    sizeMB: 312,
    downloadUrl: 'github-release://thewh1teagle/kokoro-onnx/model-files-v1.0',
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
    downloadUrl: 'github-release://thewh1teagle/kokoro-onnx/model-files-v1.0',
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
  const enabled = input?.enabled ?? false;
  // When voice is enabled, web mode must not be 'off' — otherwise voice UI stays hidden.
  // Default to 'push-to-talk' if the persisted config has enabled=true but mode.web='off'.
  const inputWebMode = input?.mode?.web;
  const webMode = enabled && (!inputWebMode || inputWebMode === 'off')
    ? 'push-to-talk'
    : (inputWebMode ?? 'off');
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...input,
    enabled,
    mode: { web: webMode, channels: input?.mode?.channels ?? 'off' },
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
