/** Fallback when persona name is unset. */
export const WAKE_WORD_FALLBACK = 'agent x';

export function normalizeWakePhrase(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Wake phrase follows the agent persona name (e.g. "JARVIS" → "jarvis"). */
export function resolveWakePhrase(personaName?: string | null): string {
  const trimmed = personaName?.trim();
  if (trimmed) return normalizeWakePhrase(trimmed);
  return WAKE_WORD_FALLBACK;
}

export function shouldBeginPushToTalkOnSpace(options: {
  globalSpace?: boolean;
  composerFocused: boolean;
  composerEmpty: boolean;
  repeat: boolean;
}): boolean {
  if (options.repeat) return false;
  if (options.globalSpace) return true;
  return options.composerFocused && options.composerEmpty;
}

export function shouldEndPushToTalkOnSpace(options: {
  globalSpace?: boolean;
  composerFocused: boolean;
}): boolean {
  return Boolean(options.globalSpace || options.composerFocused);
}
