import { normalizeTextForSpeech } from '@agentx/engine';

export const VOICE_BLOCK_OPEN = '⟨voice⟩';
export const VOICE_BLOCK_CLOSE = '⟨/voice⟩';

const VOICE_BLOCK_RE = /⟨voice⟩([\s\S]*?)⟨\/voice⟩/i;
const VOICE_BLOCK_STRIP_RE = /⟨voice⟩[\s\S]*?⟨\/voice⟩\s*/gi;

export function buildVoiceTurnInstruction(): string {
  return `VOICE CHANNEL — the user is listening via text-to-speech.

Your reply has two sections:

1) Start with a brief spoken summary inside this exact wrapper (plain sentences only — no markdown, URLs, bullet lists, tables, or source chips). Give the key facts concisely and tell the user the full detailed report with links is in the chat:

${VOICE_BLOCK_OPEN}
2–4 short sentences here.
${VOICE_BLOCK_CLOSE}

2) After the closing tag, write the full chat answer with markdown, links, tables, and sources as usual.

Rules:
- Put the ${VOICE_BLOCK_OPEN} block before the detailed chat body.
- Never put markdown or URLs inside the voice block.
- Keep the voice block under 80 words.`;
}

export function extractVoiceSpeakable(content: string): { voice: string; chat: string } {
  const match = content.match(VOICE_BLOCK_RE);
  if (!match) {
    return { voice: '', chat: content.trim() };
  }
  const voice = match[1]?.trim() ?? '';
  const chat = content.replace(VOICE_BLOCK_STRIP_RE, '').trim();
  return { voice, chat };
}

export function stripVoiceChannelBlock(content: string): string {
  return content.replace(VOICE_BLOCK_STRIP_RE, '').trim();
}

export function buildVoiceFallback(chat: string): string {
  const normalized = normalizeTextForSpeech(chat, { maxChars: 320 });
  if (!normalized) {
    return 'I have posted the answer in the chat for you.';
  }
  return `${normalized} The full report with links and details is in the chat.`;
}

/** Extracts speakable deltas from streamed assistant output (voice block only). */
export class VoiceBlockStreamExtractor {
  private raw = '';
  private voiceEmitted = 0;
  private voiceClosed = false;

  get closed(): boolean {
    return this.voiceClosed;
  }

  pullSpeakDelta(delta: string): string {
    if (this.voiceClosed || !delta) return '';
    this.raw += delta;

    let body = this.raw;
    const openIdx = body.indexOf(VOICE_BLOCK_OPEN);
    if (openIdx === -1) {
      if (body.length > 24) this.raw = body.slice(-24);
      return '';
    }
    body = body.slice(openIdx + VOICE_BLOCK_OPEN.length);

    const closeIdx = body.indexOf(VOICE_BLOCK_CLOSE);
    if (closeIdx === -1) {
      const speakable = body.slice(this.voiceEmitted);
      this.voiceEmitted = body.length;
      return speakable;
    }

    const inner = body.slice(0, closeIdx);
    const speakable = inner.slice(this.voiceEmitted);
    this.voiceEmitted = inner.length;
    this.voiceClosed = true;
    return speakable;
  }
}
