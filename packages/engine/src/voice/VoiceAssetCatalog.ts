import type { VoiceAssetCatalogEntry, VoiceComputeDevice, VoiceConfig, VoiceDownloadedAsset } from '@agentx/shared';

export const DEFAULT_VOICE_CONFIG: Required<Pick<VoiceConfig, 'enabled' | 'mode' | 'engine' | 'xai' | 'stt' | 'tts' | 'sidecar' | 'fillers' | 'downloadedAssets'>> = {
  enabled: false,
  mode: {
    web: 'off',
    channels: 'off',
  },
  engine: 'stt_llm_tts',
  xai: {
    model: 'grok-voice-latest',
    voice: 'eve',
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
  // If the user has configured an xAI key or explicitly chosen the realtime_xai
  // engine, default voice to enabled so the dashboard voice card appears
  // without requiring a manual save. Also default the engine to xAI when an
  // xAI API key is present, so the UI doesn't try to boot the local sidecar.
  const hasXaiCredentials = Boolean(input?.xai?.apiKey);
  const engine = input?.engine ?? (hasXaiCredentials ? 'realtime_xai' : DEFAULT_VOICE_CONFIG.engine);
  const isXai = engine === 'realtime_xai';
  const enabled = input?.enabled ?? (hasXaiCredentials || isXai);
  // When voice is enabled, web mode must not be 'off' — otherwise voice UI stays hidden.
  // xAI is always duplex; Local is always push-to-talk (coerce away stale duplex).
  const inputWebMode = input?.mode?.web;
  let webMode = enabled && (!inputWebMode || inputWebMode === 'off' || (isXai && inputWebMode !== 'duplex'))
    ? (isXai ? 'duplex' : 'push-to-talk')
    : (inputWebMode ?? 'off');
  if (!isXai && webMode === 'duplex') webMode = 'push-to-talk';
  if (isXai && enabled && webMode !== 'off' && webMode !== 'duplex') webMode = 'duplex';
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...input,
    enabled,
    mode: { web: webMode, channels: input?.mode?.channels ?? 'off' },
    engine,
    xai: { ...DEFAULT_VOICE_CONFIG.xai, ...input?.xai },
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
