export type VoiceSessionMode = 'off' | 'push-to-talk' | 'duplex' | 'voice-notes';

export type VoiceTransportKind = 'web' | 'desktop' | 'telegram' | 'slack' | 'discord' | 'voip';

export type VoiceAssetKind =
  | 'python-runtime'
  | 'sidecar-dependency'
  | 'stt-model'
  | 'tts-model'
  | 'tts-voice'
  | 'vad-model'
  | 'helper-binary';

export type SttEngine = 'faster-whisper';

export type FasterWhisperComputeType = 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';

export type VoiceComputeDevice = 'auto' | 'cpu' | 'cuda';

export type TtsEngine = 'kokoro';

export type VoiceEngineType = 'stt_llm_tts' | 'realtime_xai';

export interface VoiceXaiConfig {
  apiKey?: string;
  /** xAI realtime model, e.g. grok-voice-latest. */
  model?: string;
  /** xAI voice ID, e.g. eve. */
  voice?: string;
  /** Optional WSS override. Defaults to wss://api.x.ai/v1/realtime. */
  baseUrl?: string;
}

export interface VoiceSurfaceConfig {
  web?: 'off' | 'push-to-talk' | 'duplex';
  channels?: 'off' | 'voice-notes';
}

export interface VoiceSttConfig {
  engine: SttEngine;
  modelId?: string;
  computeType?: FasterWhisperComputeType;
  device?: VoiceComputeDevice;
}

export interface VoiceTtsStyleConfig {
  emotion?: string;
  expressiveness?: number;
}

export interface VoiceTtsConfig {
  engine: TtsEngine;
  voiceId?: string;
  style?: VoiceTtsStyleConfig;
  /** Fillers intentionally remain Kokoro-backed for low-latency progress speech. */
  fillerEngine?: 'kokoro';
}

export interface VoiceFillerConfig {
  enabled?: boolean;
  speakToolProgress?: boolean;
}

export interface VoiceSidecarConfig {
  /** When true, warm the sidecar as soon as the web UI loads. Default false to save RAM. */
  autoStart?: boolean;
  /** Unload the sidecar after this many idle minutes (0 = never). Default 5. */
  idleUnloadMinutes?: number;
}

export interface VoiceDownloadedAsset {
  assetId: string;
  kind: VoiceAssetKind;
  engine?: SttEngine | TtsEngine;
  version?: string;
  installedAt: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface VoiceAssetCatalogEntry {
  id: string;
  kind: VoiceAssetKind;
  engine?: SttEngine | TtsEngine;
  displayName: string;
  description: string;
  sizeMB: number;
  platform?: string;
  architecture?: string;
  downloadUrl?: string;
  sha256?: string;
  deliveryTier?: 'bundled' | 'download' | 'optional';
  license?: string;
  recommended?: boolean;
}

export interface VoiceProviderConfig {
  /** Provider for voice sessions. Defaults to cfg.provider.activeProvider. */
  activeProvider?: string;
  /** Model for voice sessions. Defaults to cfg.provider.activeModel. */
  activeModel?: string;
  /** Provider profile label for voice sessions. Defaults to the provider's activeProfile. */
  activeProfile?: string;
}

export interface VoiceConfig {
  enabled?: boolean;
  mode?: VoiceSurfaceConfig;
  /** Active voice engine. Defaults to the local STT/LLM/TTS stack. */
  engine?: VoiceEngineType;
  /** xAI realtime settings. */
  xai?: VoiceXaiConfig;
  stt?: VoiceSttConfig;
  tts?: VoiceTtsConfig;
  sidecar?: VoiceSidecarConfig;
  fillers?: VoiceFillerConfig;
  wakeWord?: {
    enabled?: boolean;
    phrase?: string;
  };
  downloadedAssets?: VoiceDownloadedAsset[];
  /** Separate provider/model for voice sessions. Falls back to default provider config. */
  provider?: VoiceProviderConfig;
}

export type VoiceSidecarHealthState = 'not-installed' | 'stopped' | 'starting' | 'ready' | 'crashed';

export interface VoiceCapabilityStatus {
  os: string;
  arch: string;
  pythonAvailable: boolean;
  ffmpegAvailable: boolean;
  sidecar: {
    state: VoiceSidecarHealthState;
    version?: string;
    error?: string;
  };
  stt: {
    engine: SttEngine;
    selectedModelId?: string;
    selectedModelInstalled: boolean;
  };
  tts: {
    selectedEngine: TtsEngine;
    selectedVoiceId?: string;
    selectedVoiceInstalled: boolean;
    kokoroInstalled: boolean;
  };
  vadInstalled: boolean;
  gpuAvailable?: boolean;
  canRunWeb: boolean;
  canRunChannels: boolean;
  /** Active/selected engine. */
  engine?: VoiceEngineType;
  /** xAI realtime readiness. */
  realtimeXai?: {
    configured: boolean;
    reachable?: boolean;
    error?: string;
  };
}
