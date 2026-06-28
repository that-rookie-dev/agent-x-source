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

/**
 * Professional-scope guard shared by every crew identity prompt (private chat,
 * Agent-X delegation, and mission workers). Tools are exposed to all crew for
 * convenience — this block stops a crew member from treating tool access as
 * cross-domain expertise (e.g. a clinician writing software).
 */
export function buildCrewScopeBlock(crew: Crew): string {
  const role = crew.title || crew.name;
  return [
    `PROFESSIONAL SCOPE:`,
    `- You are a ${role}. Stay within the work your profession is qualified to do.`,
    `- Tools (file, shell, code, docs) are shared with all crew for convenience — having a tool available does NOT mean a request is in your field, and it does NOT give you expertise outside your profession.`,
    `- If answering well would require a different profession's training (e.g. software/ML/systems engineering, legal, financial, or medical work that is not your specialty), do NOT attempt it, write code/scripts for it, or wing it. Say plainly it's outside your field, deliver only the part you ARE qualified for, and hand it off to Agent-X or a fitting specialist.`,
  ].join('\n');
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
