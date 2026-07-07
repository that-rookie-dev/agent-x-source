import type { VoiceConfig } from '../api';

/** Pre-planned bundle — users never pick individual models in the default UI. */
export const RECOMMENDED_VOICE_ASSET_IDS = [
  'faster-whisper-base.en',
  'kokoro-82m',
  'kokoro-af',
  'silero-vad',
] as const;

export const VOICE_DEPLOY_STEPS = [
  'Deploy installs bundled Silero VAD and downloads speech models (~480 MB).',
  'Hold Space in chat voice mode to talk — release to send.',
  'Run a comms check: hear a sample line, then test your microphone.',
  'Open Chat, switch to Voice, and hold Space to speak.',
] as const;

/** Hands-free (duplex) UI — hidden until push-to-talk is polished. */
export const VOICE_HANDS_FREE_ENABLED = false;

export function mergeVoiceConfig(input?: VoiceConfig | null): VoiceConfig {
  return {
    enabled: input?.enabled ?? false,
    mode: { web: 'off', channels: 'off', ...input?.mode },
    stt: {
      engine: 'faster-whisper',
      modelId: 'faster-whisper-base.en',
      computeType: 'int8',
      device: 'auto',
      ...input?.stt,
    },
    tts: {
      engine: 'kokoro',
      fillerEngine: 'kokoro',
      ...input?.tts,
      voiceId: input?.tts?.voiceId ?? ((input?.tts?.engine ?? 'kokoro') === 'styletts2' ? 'styletts2-default' : 'kokoro-af'),
    },
    sidecar: { autoStart: false, idleUnloadMinutes: 5, ...input?.sidecar },
    fillers: { enabled: true, speakToolProgress: true, ...input?.fillers },
    wakeWord: { enabled: false, ...input?.wakeWord },
    downloadedAssets: input?.downloadedAssets ?? [],
  };
}

export function applyVoicePreset(config: VoiceConfig): VoiceConfig {
  // Preserve the user's TTS engine choice; only fill in defaults when unset.
  const engine = config.tts?.engine ?? 'kokoro';
  return mergeVoiceConfig({
    ...config,
    enabled: true,
    stt: { modelId: 'faster-whisper-base.en', computeType: 'int8', device: 'auto' },
    tts: {
      engine,
      voiceId: config.tts?.voiceId ?? (engine === 'styletts2' ? 'styletts2-default' : 'kokoro-af'),
      fillerEngine: 'kokoro',
    },
  });
}

export const STYLETTS2_ASSET_IDS = ['styletts2', 'styletts2-default'] as const;

export function isStyleTts2Installed(installedIds: Set<string>): boolean {
  return STYLETTS2_ASSET_IDS.every((id) => installedIds.has(id));
}

export function isVoiceKitReady(
  installedIds: Set<string>,
  capabilities: { pythonAvailable?: boolean; ffmpegAvailable?: boolean; canRunWeb?: boolean } | null,
): boolean {
  if (!capabilities?.pythonAvailable || !capabilities?.ffmpegAvailable) return false;
  return RECOMMENDED_VOICE_ASSET_IDS.every((id) => installedIds.has(id));
}
