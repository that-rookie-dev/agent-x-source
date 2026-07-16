import type {
  VoiceSidecarCancelRequest,
  VoiceSidecarHealth,
  VoiceSidecarStreamSynthesizeRequest,
  VoiceSidecarStreamSynthesizeResponse,
  VoiceSidecarStreamTranscribeRequest,
  VoiceSidecarStreamTranscribeResponse,
  VoiceSidecarSynthesizeRequest,
  VoiceSidecarSynthesizeResponse,
  VoiceSidecarTranscribeRequest,
  VoiceSidecarTranscribeResponse,
  VoiceSidecarVadDetectResponse,
  VoiceSidecarWarmRequest,
} from './VoiceSidecarProtocol.js';
import { getLogger } from '@agentx/shared';

export interface VoiceSidecarClientOptions {
  baseUrl: string;
  authToken: string;
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class VoiceSidecarClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;

  constructor(options: VoiceSidecarClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  health(timeoutMs = 2_000): Promise<VoiceSidecarHealth> {
    return this.request<VoiceSidecarHealth>('GET', '/health', undefined, timeoutMs);
  }

  warm(request: VoiceSidecarWarmRequest): Promise<VoiceSidecarHealth> {
    return this.request<VoiceSidecarHealth>('POST', '/warm', request, 120_000);
  }

  transcribe(request: VoiceSidecarTranscribeRequest): Promise<VoiceSidecarTranscribeResponse> {
    return this.request<VoiceSidecarTranscribeResponse>('POST', '/stt/transcribe', request, this.timeoutMs);
  }

  transcribePcm(pcm: Buffer, sampleRate = 16_000, options: Omit<VoiceSidecarTranscribeRequest, 'audioPath'> = {}): Promise<VoiceSidecarTranscribeResponse> {
    return this.request<VoiceSidecarTranscribeResponse>('POST', '/stt/transcribe', {
      ...options,
      pcmBase64: pcm.toString('base64'),
      sampleRate,
    }, this.timeoutMs);
  }

  streamTranscribe(request: VoiceSidecarStreamTranscribeRequest): Promise<VoiceSidecarStreamTranscribeResponse> {
    return this.request<VoiceSidecarStreamTranscribeResponse>('POST', '/stt/stream', request, this.timeoutMs);
  }

  synthesize(request: VoiceSidecarSynthesizeRequest): Promise<VoiceSidecarSynthesizeResponse> {
    return this.request<VoiceSidecarSynthesizeResponse>('POST', '/tts/synthesize', request, this.timeoutMs);
  }

  synthesizeStream(request: VoiceSidecarStreamSynthesizeRequest): Promise<VoiceSidecarStreamSynthesizeResponse> {
    return this.request<VoiceSidecarStreamSynthesizeResponse>('POST', '/tts/stream', request, this.timeoutMs);
  }

  async cancel(request: VoiceSidecarCancelRequest): Promise<void> {
    await this.request<{ ok: boolean }>('POST', '/cancel', request, 5_000);
  }

  detectVad(pcm: Buffer, sampleRate = 16_000, threshold?: number): Promise<VoiceSidecarVadDetectResponse> {
    return this.request<VoiceSidecarVadDetectResponse>('POST', '/vad/detect', {
      pcm: pcm.toString('base64'),
      sampleRate,
      threshold,
    }, 5_000);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.authToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: any;
      try {
        payload = text.length > 0 ? JSON.parse(text) : undefined;
      } catch (error) {
        getLogger().warn('VOICE_SIDECAR_CLIENT', `Failed to parse sidecar response: ${error instanceof Error ? error.message : String(error)}`);
        payload = undefined;
      }

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : `Voice sidecar request failed: ${response.status}`;
        throw new Error(message);
      }

      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
