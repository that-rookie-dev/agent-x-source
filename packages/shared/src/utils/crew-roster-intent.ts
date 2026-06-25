/**
 * Detect when the user is asking for people, skills, or workforce — crew roster
 * should be checked before external hiring / staffing advice.
 */

const EXPLICIT_CREW_PATTERNS = [
  /\b(involve|bring in|suggest|recommend|get|find|list|show|want|need)\s+(the\s+)?(crew|specialist|team|crew members?)\b/i,
  /\bcrew\s+members?\s+(who|with|that|for)\b/i,
  /\b(suggest|recommend|find|list|show)\s+(some\s+)?crew\b/i,
  /\bwho should (help|handle|work on)\b/i,
] as const;

const WORKFORCE_PATTERNS = [
  /\b(need|want|looking for|searching for|find|get|hire|hiring|recruit|recruiting|staff|staffing)\b.{0,48}\b(skilled\s+)?(person|people|professional|specialist|expert|consultant|developer|engineer|designer|analyst|advisor|talent|resource|team member|someone|anyone)\b/i,
  /\b(workforce|headcount|talent)\b.{0,32}\b(need|plan|planning|required|gap|shortage)\b/i,
  /\b(who can|who should)\s+(help|handle|do|work|assist)\b/i,
  /\b(specialist|expert|consultant)\s+(for|with|in|who)\b/i,
  /\b(skillset|skill set|skills required|resources required|right person|right people)\b/i,
  /\b(need|want)\s+(a\s+)?(skilled|qualified|experienced)\b/i,
] as const;

export function isWorkforceOrSpecialistNeed(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return WORKFORCE_PATTERNS.some((p) => p.test(trimmed));
}

/** User explicitly asked for crew / roster help (re-opens dismissed suggestions). */
export function explicitCrewRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (EXPLICIT_CREW_PATTERNS.some((p) => p.test(trimmed))) return true;
  return isWorkforceOrSpecialistNeed(trimmed);
}

/** Gate or suggest crew roster before agent plans external hiring. */
export function prefersCrewRosterFirst(text: string): boolean {
  return explicitCrewRequest(text);
}
