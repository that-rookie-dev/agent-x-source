export type FasterWhisperComputeType = 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';

export type VoiceComputeDevice = 'auto' | 'cpu' | 'cuda';

export type TtsEngine = 'kokoro';

export interface VoiceSidecarHealth {
  ok: boolean;
  state: 'starting' | 'ready' | 'error';
  version?: string;
  models?: {
    sttLoaded?: boolean;
    ttsEngine?: TtsEngine;
    ttsLoaded?: boolean;
    vadLoaded?: boolean;
  };
  device?: VoiceComputeDevice;
  error?: string;
}

export interface VoiceSidecarWarmRequest {
  sttModelId?: string;
  sttComputeType?: FasterWhisperComputeType;
  sttDevice?: VoiceComputeDevice;
  ttsEngine?: TtsEngine;
  ttsVoiceId?: string;
}

export interface VoiceSidecarTranscribeRequest {
  audioPath: string;
  modelId?: string;
  language?: string;
}

export interface VoiceSidecarTranscriptSegment {
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
}

export interface VoiceSidecarTranscribeResponse {
  text: string;
  language?: string;
  confidence?: number;
  segments?: VoiceSidecarTranscriptSegment[];
  timings?: Record<string, number>;
}

export interface VoiceSidecarSynthesizeRequest {
  text: string;
  engine: TtsEngine;
  voiceId?: string;
  outputPath?: string;
  style?: {
    emotion?: string;
    expressiveness?: number;
  };
}

export interface VoiceSidecarSynthesizeResponse {
  audioPath?: string;
  sampleRate?: number;
  durationMs?: number;
  timings?: Record<string, number>;
}

export interface VoiceSidecarStreamTranscribeRequest {
  pcmBase64?: string;
  sampleRate?: number;
  reset?: boolean;
  finalize?: boolean;
  /** Decode request PCM for live captions without mutating the stream buffer. */
  preview?: boolean;
  modelId?: string;
  language?: string;
}

export interface VoiceSidecarStreamTranscribeResponse {
  partial?: string | null;
  text?: string | null;
  isSpeech?: boolean | null;
  speechEnd?: boolean;
  segments?: VoiceSidecarTranscriptSegment[];
  language?: string;
  confidence?: number;
  vad?: VoiceSidecarVadDetectResponse;
}

export interface VoiceSidecarStreamSynthesizeRequest {
  text: string;
  engine: TtsEngine;
  voiceId?: string;
  requestId?: string;
  style?: {
    emotion?: string;
    expressiveness?: number;
  };
}

export interface VoiceSidecarStreamAudioChunk {
  pcmBase64: string;
  sampleRate: number;
}

export interface VoiceSidecarStreamSynthesizeResponse {
  chunks: VoiceSidecarStreamAudioChunk[];
}

export interface VoiceSidecarCancelRequest {
  requestId: string;
}

export interface VoiceSidecarVadDetectRequest {
  pcm: string;
  sampleRate?: number;
  threshold?: number;
}

export interface VoiceSidecarVadDetectResponse {
  isSpeech: boolean;
  confidence?: number;
  speechStartMs?: number | null;
  speechEndMs?: number | null;
}
