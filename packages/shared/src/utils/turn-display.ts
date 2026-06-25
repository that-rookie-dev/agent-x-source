import { stripToolNoise } from './text-sanitize.js';
import { repairStreamTextGlitches } from './stream-text.js';
import { summarizeTurnForFeedback } from '../types/turn-feedback.js';

type PartLike = { type?: string; content?: string };

/** Canonical display text for feedback summaries (content + text parts). */
export function displayTextForTurnFeedback(message: {
  content?: string;
  parts?: PartLike[];
}): string {
  const contentText = repairStreamTextGlitches(stripToolNoise(message.content || ''));
  if (!message.parts?.length) return contentText;

  const partsText = repairStreamTextGlitches(
    stripToolNoise(
      message.parts
        .filter((p) => p.type === 'text' && p.content)
        .map((p) => p.content!)
        .join(''),
    ),
  );

  if (!contentText) return partsText;
  if (!partsText) return contentText;
  if (partsText.length > contentText.length * 1.15 && partsText.includes(contentText.slice(0, 40))) {
    return contentText;
  }
  return partsText.length >= contentText.length ? partsText : contentText;
}

export function summarizeMessageForTurnFeedback(message: {
  content?: string;
  parts?: PartLike[];
}, maxLen = 160): string {
  return summarizeTurnForFeedback(displayTextForTurnFeedback(message), maxLen);
}
