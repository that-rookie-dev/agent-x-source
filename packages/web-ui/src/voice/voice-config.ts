import type { VoiceConfig } from '../api';

/** Pre-planned bundle — users never pick individual models in the default UI. */
export const RECOMMENDED_VOICE_ASSET_IDS = [
  'faster-distil-whisper-small.en',
  'kokoro-onnx',
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

export interface KokoroVoiceProfile {
  id: string;
  name: string;
  gender: 'F' | 'M';
  grade: string;
  language: string;
  description: string;
}

export const KOKORO_VOICE_PROFILES: KokoroVoiceProfile[] = [
  // American English (11F, 9M)
  { id: 'kokoro-af',      name: 'Heart',    gender: 'F', grade: 'A',  language: 'American English',  description: 'Warm, natural female. Best overall quality.' },
  { id: 'af_bella',       name: 'Bella',    gender: 'F', grade: 'A-', language: 'American English',  description: 'High quality female. Popular alternative.' },
  { id: 'af_nicole',      name: 'Nicole',   gender: 'F', grade: 'B-', language: 'American English',  description: 'Clear female, good for narration.' },
  { id: 'af_sarah',       name: 'Sarah',    gender: 'F', grade: 'C+', language: 'American English',  description: 'Soft female voice.' },
  { id: 'af_aoede',       name: 'Aoede',    gender: 'F', grade: 'C+', language: 'American English',  description: 'Female voice with unique tone.' },
  { id: 'af_kore',        name: 'Kore',     gender: 'F', grade: 'C+', language: 'American English',  description: 'Female voice.' },
  { id: 'af_alloy',       name: 'Alloy',    gender: 'F', grade: 'C',  language: 'American English',  description: 'Female voice.' },
  { id: 'af_nova',        name: 'Nova',     gender: 'F', grade: 'C',  language: 'American English',  description: 'Female voice.' },
  { id: 'af_sky',         name: 'Sky',      gender: 'F', grade: 'C-', language: 'American English',  description: 'Female voice.' },
  { id: 'af_jessica',     name: 'Jessica',  gender: 'F', grade: 'D',  language: 'American English',  description: 'Female voice.' },
  { id: 'af_river',       name: 'River',    gender: 'F', grade: 'D',  language: 'American English',  description: 'Female voice.' },
  { id: 'am_michael',     name: 'Michael',  gender: 'M', grade: 'C+', language: 'American English',  description: 'Best male voice quality.' },
  { id: 'am_fenrir',      name: 'Fenrir',   gender: 'M', grade: 'C+', language: 'American English',  description: 'Deep male voice.' },
  { id: 'am_puck',        name: 'Puck',     gender: 'M', grade: 'C+', language: 'American English',  description: 'Lighter male voice.' },
  { id: 'am_eric',        name: 'Eric',     gender: 'M', grade: 'D',  language: 'American English',  description: 'Male voice.' },
  { id: 'am_echo',        name: 'Echo',     gender: 'M', grade: 'D',  language: 'American English',  description: 'Male voice.' },
  { id: 'am_liam',        name: 'Liam',     gender: 'M', grade: 'D',  language: 'American English',  description: 'Male voice.' },
  { id: 'am_onyx',        name: 'Onyx',     gender: 'M', grade: 'D',  language: 'American English',  description: 'Male voice.' },
  { id: 'am_adam',        name: 'Adam',     gender: 'M', grade: 'F+', language: 'American English',  description: 'Male voice. Lower quality.' },
  { id: 'am_santa',       name: 'Santa',    gender: 'M', grade: 'D-', language: 'American English',  description: 'Novelty male voice.' },

  // British English (4F, 4M)
  { id: 'bf_emma',        name: 'Emma',     gender: 'F', grade: 'B-', language: 'British English',   description: 'Best British female voice.' },
  { id: 'bf_isabella',    name: 'Isabella', gender: 'F', grade: 'C',  language: 'British English',   description: 'British female voice.' },
  { id: 'bf_alice',       name: 'Alice',    gender: 'F', grade: 'D',  language: 'British English',   description: 'British female voice.' },
  { id: 'bf_lily',        name: 'Lily',     gender: 'F', grade: 'D',  language: 'British English',   description: 'British female voice.' },
  { id: 'bm_george',      name: 'George',   gender: 'M', grade: 'C',  language: 'British English',   description: 'British male voice.' },
  { id: 'bm_fable',       name: 'Fable',    gender: 'M', grade: 'C',  language: 'British English',   description: 'British male voice.' },
  { id: 'bm_lewis',       name: 'Lewis',    gender: 'M', grade: 'D+', language: 'British English',   description: 'British male voice.' },
  { id: 'bm_daniel',      name: 'Daniel',   gender: 'M', grade: 'D',  language: 'British English',   description: 'British male voice.' },

  // Japanese (4F, 1M)
  { id: 'jf_alpha',       name: 'Alpha',    gender: 'F', grade: 'C+', language: 'Japanese',          description: 'Japanese female voice.' },
  { id: 'jf_gongitsune',  name: 'Gongitsune', gender: 'F', grade: 'C', language: 'Japanese',        description: 'Japanese female, CC BY.' },
  { id: 'jf_tebukuro',    name: 'Tebukuro', gender: 'F', grade: 'C',  language: 'Japanese',          description: 'Japanese female, CC BY.' },
  { id: 'jf_nezumi',      name: 'Nezumi',   gender: 'F', grade: 'C-', language: 'Japanese',          description: 'Japanese female, CC BY.' },
  { id: 'jm_kumo',        name: 'Kumo',     gender: 'M', grade: 'C-', language: 'Japanese',          description: 'Japanese male, CC BY.' },

  // Mandarin Chinese (4F, 4M)
  { id: 'zf_xiaobei',     name: 'Xiaobei',  gender: 'F', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin female voice.' },
  { id: 'zf_xiaoni',      name: 'Xiaoni',   gender: 'F', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin female voice.' },
  { id: 'zf_xiaoxiao',    name: 'Xiaoxiao', gender: 'F', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin female voice.' },
  { id: 'zf_xiaoyi',      name: 'Xiaoyi',   gender: 'F', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin female voice.' },
  { id: 'zm_yunjian',     name: 'Yunjian',  gender: 'M', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin male voice.' },
  { id: 'zm_yunxi',       name: 'Yunxi',    gender: 'M', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin male voice.' },
  { id: 'zm_yunxia',      name: 'Yunxia',   gender: 'M', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin male voice.' },
  { id: 'zm_yunyang',     name: 'Yunyang',  gender: 'M', grade: 'D',  language: 'Mandarin Chinese',  description: 'Mandarin male voice.' },

  // Spanish (1F, 2M)
  { id: 'ef_dora',        name: 'Dora',     gender: 'F', grade: '—',  language: 'Spanish',           description: 'Spanish female voice.' },
  { id: 'em_alex',        name: 'Alex',     gender: 'M', grade: '—',  language: 'Spanish',           description: 'Spanish male voice.' },
  { id: 'em_santa',       name: 'Santa',    gender: 'M', grade: '—',  language: 'Spanish',           description: 'Spanish male voice.' },

  // French (1F)
  { id: 'ff_siwis',       name: 'Siwis',    gender: 'F', grade: 'B-', language: 'French',            description: 'French female voice. CC BY SIWIS.' },

  // Hindi (2F, 2M)
  { id: 'hf_alpha',       name: 'Alpha',    gender: 'F', grade: 'C',  language: 'Hindi',             description: 'Hindi female voice.' },
  { id: 'hf_beta',        name: 'Beta',     gender: 'F', grade: 'C',  language: 'Hindi',             description: 'Hindi female voice.' },
  { id: 'hm_omega',       name: 'Omega',    gender: 'M', grade: 'C',  language: 'Hindi',             description: 'Hindi male voice.' },
  { id: 'hm_psi',         name: 'Psi',      gender: 'M', grade: 'C',  language: 'Hindi',             description: 'Hindi male voice.' },

  // Italian (1F, 1M)
  { id: 'if_sara',        name: 'Sara',     gender: 'F', grade: 'C',  language: 'Italian',           description: 'Italian female voice.' },
  { id: 'im_nicola',      name: 'Nicola',   gender: 'M', grade: 'C',  language: 'Italian',           description: 'Italian male voice.' },

  // Brazilian Portuguese (1F, 2M)
  { id: 'pf_dora',        name: 'Dora',     gender: 'F', grade: '—',  language: 'Brazilian Portuguese', description: 'Brazilian Portuguese female voice.' },
  { id: 'pm_alex',        name: 'Alex',     gender: 'M', grade: '—',  language: 'Brazilian Portuguese', description: 'Brazilian Portuguese male voice.' },
  { id: 'pm_santa',       name: 'Santa',    gender: 'M', grade: '—',  language: 'Brazilian Portuguese', description: 'Brazilian Portuguese male voice.' },
];

export function mergeVoiceConfig(input?: VoiceConfig | null): VoiceConfig {
  const hasXaiCredentials = Boolean(input?.xai?.apiKey);
  const engine = input?.engine ?? (hasXaiCredentials ? 'realtime_xai' : 'stt_llm_tts');
  const isXai = engine === 'realtime_xai';
  const enabled = input?.enabled ?? (hasXaiCredentials || isXai);
  // When voice is enabled, web mode must not be 'off' — otherwise voice UI stays hidden.
  // xAI realtime defaults to duplex; local defaults to push-to-talk.
  const inputWebMode = input?.mode?.web;
  const webMode = enabled && (!inputWebMode || inputWebMode === 'off' || (isXai && inputWebMode !== 'duplex'))
    ? (isXai ? 'duplex' : 'push-to-talk')
    : (inputWebMode ?? 'off');
  return {
    enabled,
    mode: { web: webMode, channels: input?.mode?.channels ?? 'off' },
    engine,
    xai: {
      model: 'grok-voice-latest',
      voice: 'eve',
      ...input?.xai,
    },
    stt: {
      engine: 'faster-whisper',
      modelId: 'faster-distil-whisper-small.en',
      computeType: 'int8',
      device: 'auto',
      ...input?.stt,
    },
    tts: {
      engine: 'kokoro',
      fillerEngine: 'kokoro',
      ...input?.tts,
      voiceId: input?.tts?.voiceId ?? 'kokoro-af',
    },
    sidecar: { autoStart: false, idleUnloadMinutes: 5, ...input?.sidecar },
    fillers: { enabled: true, speakToolProgress: true, ...input?.fillers },
    wakeWord: { enabled: false, ...input?.wakeWord },
    downloadedAssets: input?.downloadedAssets ?? [],
    provider: input?.provider,
  };
}

export function applyVoicePreset(config: VoiceConfig): VoiceConfig {
  const isXai = config.engine === 'realtime_xai';
  return mergeVoiceConfig({
    ...config,
    enabled: true,
    mode: { ...config.mode, web: config.mode?.web && config.mode.web !== 'off' ? config.mode.web : (isXai ? 'duplex' : 'push-to-talk') },
    stt: { modelId: 'faster-distil-whisper-small.en', computeType: 'int8', device: 'auto' },
    tts: {
      engine: 'kokoro',
      voiceId: config.tts?.voiceId ?? 'kokoro-af',
      fillerEngine: 'kokoro',
    },
  });
}

export function isVoiceKitReady(
  installedIds: Set<string>,
  capabilities: { pythonAvailable?: boolean; ffmpegAvailable?: boolean; canRunWeb?: boolean } | null,
): boolean {
  if (!capabilities?.pythonAvailable || !capabilities?.ffmpegAvailable) return false;
  return RECOMMENDED_VOICE_ASSET_IDS.every((id) => installedIds.has(id));
}
