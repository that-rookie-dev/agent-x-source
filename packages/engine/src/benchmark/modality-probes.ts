import type { ModelCapability, ProviderId } from '@agentx/shared';
import type { ModalityProbeId, ModalityProbeResult } from './types.js';
import { humanizeHttpError, humanizeProbeError } from './probe-errors.js';

/** 1x1 blue PNG. The prompt never mentions the color. */
const BLUE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const BLUE_WORDS = ['blue', 'azure', 'cyan', 'navy', 'indigo', 'cobalt', 'teal'];
const TONE_WORDS = ['tone', 'beep', 'sine', 'audio', 'sound'];

/**
 * Tiny MP4 fixture for video-input probing. If a provider rejects it, the probe
 * reports the API error instead of inferring support.
 */
const TINY_MP4_B64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAABIbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAACZpb2RzAAAAABCAgIAH//8ABICAAQABAAEAAAB4dHJhawAAAFx0a2hkAAAABwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAEAAAABAAAAAAAkaWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAA8AAAAPFUAAAAAACFoZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAbNtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAFzc3RibAAAAMdzdHNkAAAAAAAAAAEAAAC3YXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAEAAAEASAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//wAAABhhc3BlY3QAAAAAAAAAAQAAAAEAAAAAFGF2Y0MAAVoACv/hABhnWgAKzZQeA8ARPy4C3AQEBQAAAwABAAADAAHjBjLAAAAEaM48gAABAAQAAAEGaO48gAAAABBzdHRzAAAAAAAAAAEAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAABAAAAAQAAABRzdGNvAAAAAAAAAAEAAAJtAAAAOG1kYXQAAAGxBgX//+3qAAAAAANliIhEAAAB9AA=';

export interface ModalityProbeConfig {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  modelCapabilities?: ModelCapability[];
}

type ProbeOutcome = Pick<ModalityProbeResult, 'detected' | 'source' | 'tested' | 'probeStatus' | 'note' | 'details'>;

function openAiBaseUrl(providerId: string, baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  switch (providerId as ProviderId) {
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'together': return 'https://api.together.xyz/v1';
    case 'xai': return 'https://api.x.ai/v1';
    case 'fireworks': return 'https://api.fireworks.ai/inference/v1';
    case 'deepseek': return 'https://api.deepseek.com';
    case 'moonshot': return 'https://api.moonshot.ai/v1';
    case 'commandcode': return 'https://api.commandcode.ai/provider/v1';
    case 'opencode': return 'https://opencode.ai/zen/go/v1';
    case 'opencode-zen': return 'https://opencode.ai/zen/v1';
    case 'google': return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'ollama': return 'http://localhost:11434/v1';
    case 'lmstudio': return 'http://localhost:1234/v1';
    default: return 'https://api.openai.com/v1';
  }
}

async function readChatText(res: Response): Promise<string> {
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw humanizeHttpError(res.status, err);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ type?: string; text?: string }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const openAi = json.choices?.[0]?.message?.content;
  if (typeof openAi === 'string') return openAi.trim();
  const anthropic = json.content
    ?.filter((c) => c.type === 'text' || c.text)
    .map((c) => c.text ?? '')
    .join('');
  if (anthropic) return anthropic.trim();
  const gemini = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (gemini) return gemini.trim();
  return '';
}

function blueColorDetected(text: string): boolean {
  const lower = text.toLowerCase();
  return BLUE_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

function toneDetected(text: string): boolean {
  const lower = text.toLowerCase();
  return TONE_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

function makeToneWavBase64(): string {
  const sampleRate = 16_000;
  const durationSeconds = 0.35;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 0x3fff);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer.toString('base64');
}

function unsupportedOutcome(channel: string, error: unknown): ProbeOutcome {
  const reason = humanizeProbeError(channel, error);
  return {
    detected: false,
    source: 'probe',
    tested: true,
    probeStatus: 'unsupported',
    note: reason,
  };
}

async function probeVisionOpenAi(
  modelId: string,
  apiKey: string | undefined,
  baseUrl: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: modelId,
      max_tokens: 16,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is the primary color in this image? Reply with ONE word only.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${BLUE_PNG_B64}` } },
          ],
        },
      ],
    }),
  });

  const text = await readChatText(res);
  const ok = blueColorDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live vision probe succeeded' : 'Vision API accepted the image but did not identify the color correctly',
    details: ok
      ? `Model identified color: "${text}"`
      : `We sent a solid blue test image and asked for the primary color in one word. Expected a blue-family color name, but the model replied "${text || '(empty)'}".`,
  };
}

async function probeVisionAnthropic(
  modelId: string,
  apiKey: string,
  baseUrl: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: modelId,
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: BLUE_PNG_B64 },
            },
            { type: 'text', text: 'What is the primary color in this image? Reply with ONE word only.' },
          ],
        },
      ],
    }),
  });

  const text = await readChatText(res);
  const ok = blueColorDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live vision probe succeeded' : 'Vision API accepted the image but did not identify the color correctly',
    details: ok
      ? `Model identified color: "${text}"`
      : `We sent a solid blue test image and asked for the primary color in one word. Expected a blue-family color name, but the model replied "${text || '(empty)'}".`,
  };
}

async function probeVisionGeminiNative(
  modelId: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'image/png', data: BLUE_PNG_B64 } },
              { text: 'What is the primary color in this image? Reply with ONE word only.' },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
      }),
    },
  );

  const text = await readChatText(res);
  const ok = blueColorDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live vision probe succeeded' : 'Vision API accepted the image but did not identify the color correctly',
    details: ok
      ? `Model identified color: "${text}"`
      : `We sent a solid blue test image and asked for the primary color in one word. Expected a blue-family color name, but the model replied "${text || '(empty)'}".`,
  };
}

async function probeVision(config: ModalityProbeConfig, _hints: boolean): Promise<ProbeOutcome> {
  const signal = AbortSignal.timeout(45_000);
  try {
    if (config.providerId === 'anthropic' && config.apiKey) {
      return await probeVisionAnthropic(
        config.modelId,
        config.apiKey,
        config.baseUrl ?? 'https://api.anthropic.com',
        signal,
      );
    }
    if (config.providerId === 'google' && config.apiKey) {
      try {
        return await probeVisionGeminiNative(config.modelId, config.apiKey, signal);
      } catch {
        return await probeVisionOpenAi(
          config.modelId,
          config.apiKey,
          openAiBaseUrl('google', config.baseUrl),
          signal,
        );
      }
    }
    const baseUrl = openAiBaseUrl(config.providerId, config.baseUrl);
    return await probeVisionOpenAi(config.modelId, config.apiKey, baseUrl, signal);
  } catch (e) {
    return unsupportedOutcome('Image', e);
  }
}

async function probeImageGeneration(config: ModalityProbeConfig): Promise<ProbeOutcome> {
  const baseUrl = openAiBaseUrl(config.providerId, config.baseUrl);
  const signal = AbortSignal.timeout(60_000);
  try {
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: config.modelId,
        prompt: 'a tiny solid blue square on white background',
        n: 1,
        size: '256x256',
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw humanizeHttpError(res.status, err);
    }
    const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
    const ok = Boolean(json.data?.[0]?.url || json.data?.[0]?.b64_json);
    return {
      detected: ok,
      source: 'probe',
      tested: true,
      probeStatus: ok ? 'passed' : 'failed',
      note: ok ? 'DALL·E generation API responded' : 'Generation API returned an empty image payload',
      details: ok
        ? 'Generated test image via images/generations'
        : 'We asked the provider to generate a tiny solid blue square, but the response contained no image URL or base64 data.',
    };
  } catch (e) {
    return unsupportedOutcome('Image generation', e);
  }
}

async function probeAudioOpenAi(
  modelId: string,
  apiKey: string | undefined,
  baseUrl: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const audioB64 = makeToneWavBase64();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: modelId,
      max_tokens: 24,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What sound is in this audio? Reply with ONE word only.' },
            { type: 'input_audio', input_audio: { data: audioB64, format: 'wav' } },
          ],
        },
      ],
    }),
  });

  const text = await readChatText(res);
  const ok = toneDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live audio-input probe succeeded' : 'Audio API accepted the clip but did not identify the sound correctly',
    details: ok
      ? `Model identified audio: "${text}"`
      : `We sent a short sine-tone WAV and asked what sound it contains in one word. Expected "tone" or "beep", but the model replied "${text || '(empty)'}".`,
  };
}

async function probeAudioGeminiNative(
  modelId: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'audio/wav', data: makeToneWavBase64() } },
              { text: 'What sound is in this audio? Reply with ONE word only.' },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 24, temperature: 0 },
      }),
    },
  );

  const text = await readChatText(res);
  const ok = toneDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live audio-input probe succeeded' : 'Audio API accepted the clip but did not identify the sound correctly',
    details: ok
      ? `Model identified audio: "${text}"`
      : `We sent a short sine-tone WAV and asked what sound it contains in one word. Expected "tone" or "beep", but the model replied "${text || '(empty)'}".`,
  };
}

async function probeAudio(config: ModalityProbeConfig): Promise<ProbeOutcome> {
  const signal = AbortSignal.timeout(45_000);
  try {
    if (config.providerId === 'google' && config.apiKey) {
      try {
        return await probeAudioGeminiNative(config.modelId, config.apiKey, signal);
      } catch {
        return await probeAudioOpenAi(
          config.modelId,
          config.apiKey,
          openAiBaseUrl('google', config.baseUrl),
          signal,
        );
      }
    }
    if (config.providerId === 'anthropic') {
      throw new Error('Anthropic Messages API does not expose audio input for this benchmark');
    }
    return await probeAudioOpenAi(
      config.modelId,
      config.apiKey,
      openAiBaseUrl(config.providerId, config.baseUrl),
      signal,
    );
  } catch (e) {
    return unsupportedOutcome('Audio', e);
  }
}

async function probeVideoOpenAi(
  modelId: string,
  apiKey: string | undefined,
  baseUrl: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: modelId,
      max_tokens: 24,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is the dominant color in this video? Reply with ONE word only.' },
            { type: 'video_url', video_url: { url: `data:video/mp4;base64,${TINY_MP4_B64}` } },
          ],
        },
      ],
    }),
  });

  const text = await readChatText(res);
  const ok = blueColorDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live video-input probe succeeded' : 'Video API accepted the clip but did not identify the dominant color',
    details: ok
      ? `Model identified video color: "${text}"`
      : `We sent a short test video and asked for the dominant color in one word. Expected a blue-family color name, but the model replied "${text || '(empty)'}".`,
  };
}

async function probeVideoGeminiNative(
  modelId: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'video/mp4', data: TINY_MP4_B64 } },
              { text: 'What is the dominant color in this video? Reply with ONE word only.' },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 24, temperature: 0 },
      }),
    },
  );

  const text = await readChatText(res);
  const ok = blueColorDetected(text);
  return {
    detected: ok,
    source: 'probe',
    tested: true,
    probeStatus: ok ? 'passed' : 'failed',
    note: ok ? 'Live video-input probe succeeded' : 'Video API accepted the clip but did not identify the dominant color',
    details: ok
      ? `Model identified video color: "${text}"`
      : `We sent a short test video and asked for the dominant color in one word. Expected a blue-family color name, but the model replied "${text || '(empty)'}".`,
  };
}

async function probeVideo(config: ModalityProbeConfig): Promise<ProbeOutcome> {
  const signal = AbortSignal.timeout(60_000);
  try {
    if (config.providerId === 'google' && config.apiKey) {
      try {
        return await probeVideoGeminiNative(config.modelId, config.apiKey, signal);
      } catch {
        return await probeVideoOpenAi(
          config.modelId,
          config.apiKey,
          openAiBaseUrl('google', config.baseUrl),
          signal,
        );
      }
    }
    if (config.providerId === 'anthropic') {
      throw new Error('Anthropic Messages API does not expose video input for this benchmark');
    }
    return await probeVideoOpenAi(
      config.modelId,
      config.apiKey,
      openAiBaseUrl(config.providerId, config.baseUrl),
      signal,
    );
  } catch (e) {
    return unsupportedOutcome('Video', e);
  }
}

const PROBE_DEFS: Array<{
  id: ModalityProbeId;
  label: string;
  run: (config: ModalityProbeConfig, hints: boolean) => Promise<ProbeOutcome>;
}> = [
  { id: 'vision', label: 'Vision / image input', run: probeVision },
  { id: 'image_generation', label: 'Image generation', run: probeImageGeneration },
  { id: 'audio', label: 'Audio processing', run: probeAudio },
  { id: 'video', label: 'Video processing', run: probeVideo },
];

export async function runModalityProbes(
  config: ModalityProbeConfig,
  onProbe?: (result: ModalityProbeResult) => void,
): Promise<ModalityProbeResult[]> {
  const results: ModalityProbeResult[] = [];

  for (const def of PROBE_DEFS) {
    const outcome = await def.run(config, false);
    const result: ModalityProbeResult = {
      id: def.id,
      label: def.label,
      ...outcome,
    };
    results.push(result);
    onProbe?.(result);
  }

  return results;
}
