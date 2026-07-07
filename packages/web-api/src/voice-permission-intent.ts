/**
 * Parse a spoken utterance into a permission decision for voice-native tool approval.
 *
 * Returns null when the utterance is ambiguous, so the caller can re-prompt instead
 * of guessing (we never default to "allow" on unclear speech for safety).
 */
export type VoicePermissionIntent = 'allow_once' | 'allow_always' | 'deny' | 'approve_all';

const ALWAYS_PATTERNS = [
  /\balways\b/,
  /\bremember\b/,
  /\bevery\s*time\b/,
  /\bfrom now on\b/,
  /\bdon'?t ask again\b/,
  /\bstop asking\b/,
];

const APPROVE_ALL_PATTERNS = [
  /\bapprove all\b/,
  /\ballow all\b/,
  /\byes to all\b/,
  /\ball of (it|them)\b/,
];

const ALLOW_PATTERNS = [
  /\ballow\b/,
  /\ballowed\b/,
  /\bapprove\b/,
  /\baccept\b/,
  /\bgrant\b/,
  /\bgo ahead\b/,
  /\bproceed\b/,
  /\bcontinue\b/,
  /\bconfirm\b/,
  /\bpermit\b/,
  /\bsure\b/,
  /\bok(ay)?\b/,
  /\byes\b/,
  /\byeah\b/,
  /\byep\b/,
  /\bdo it\b/,
];

const DENY_PATTERNS = [
  /\bden(y|ied)\b/,
  /\breject\b/,
  /\bno\b/,
  /\bnope\b/,
  /\bnah\b/,
  /\bcancel\b/,
  /\bstop\b/,
  /\bskip\b/,
  /\bdon'?t\b/,
  /\bdo not\b/,
  /\bnever\b/,
  /\bblock\b/,
  /\babort\b/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function parseVoicePermissionIntent(raw: string): VoicePermissionIntent | null {
  const text = raw.toLowerCase().trim();
  if (!text) return null;

  // "approve all" and "always" are checked first because they contain allow-like words.
  if (matchesAny(text, APPROVE_ALL_PATTERNS)) return 'approve_all';

  const wantsAllow = matchesAny(text, ALLOW_PATTERNS);
  const wantsDeny = matchesAny(text, DENY_PATTERNS);

  // Explicit conflict (e.g. "no, allow it") — treat "don't"/"no" prefix as deny only if no clear allow.
  if (wantsAllow && wantsDeny) {
    // Prefer deny on conflict for safety, unless "always"/"go ahead" style intent present.
    if (matchesAny(text, ALWAYS_PATTERNS) || /\b(go ahead|do it|proceed)\b/.test(text)) {
      return matchesAny(text, ALWAYS_PATTERNS) ? 'allow_always' : 'allow_once';
    }
    return 'deny';
  }

  if (wantsAllow) {
    return matchesAny(text, ALWAYS_PATTERNS) ? 'allow_always' : 'allow_once';
  }
  if (wantsDeny) return 'deny';

  return null;
}
