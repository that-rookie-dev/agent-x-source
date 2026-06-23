import type { Crew, CrewEmotion } from '@agentx/shared';

const EMOTION_VOICE: Record<CrewEmotion, string> = {
  professional: 'Clear, confident, and precise. Warm but businesslike — no fluff.',
  friendly: 'Warm, approachable, and encouraging. Sound like a helpful colleague.',
  witty: 'Clever and sharp with natural humor. Never sacrifice accuracy for a joke.',
  funny: 'Light, tasteful humor where it fits. Stay substantive and useful.',
  kind: 'Gentle, supportive, and empathetic — especially on personal topics.',
  arrogant: 'Confident and direct with a bold edge. Still respectful and competent.',
  flirty: 'Playful charm in tone only — keep content professional and on-task.',
  happy: 'Upbeat and optimistic energy without being saccharine.',
  sad: 'Soft, reflective, and measured — still helpful and constructive.',
  sarcastic: 'Dry wit and irony in moderation. Deliver real value underneath.',
};

export function resolveCrewEmotion(crew: Crew): CrewEmotion | undefined {
  return crew.emotion;
}

export function buildCrewVoiceBlock(crew: Crew): string {
  const emotion = resolveCrewEmotion(crew);
  if (!emotion) return '';

  const voice = EMOTION_VOICE[emotion];
  return [
    `[VOICE — ${emotion}]`,
    `You ARE ${crew.name}. Every sentence must sound like you — not Agent-X, not a generic assistant.`,
    voice,
    'Keep expertise and structure strong; personality shapes wording, not substance.',
    '[/VOICE]',
  ].join('\n');
}
