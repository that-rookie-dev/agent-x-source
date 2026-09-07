/**
 * Detect explicit "create a reusable capability" asks so chat can route to
 * generateFromUserPrompt instead of one-off inline work.
 */
const CREATE_INTENT = [
  /\b(?:create|make|build|generate|write)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?(?:reusable\s+)?(?:prompt[- ]recipe\s+)?(?:tool|skill|capability)\b/i,
  /\b(?:turn|save|convert|promote)\s+(?:this|that|it)\s+into\s+a\s+(?:reusable\s+)?(?:tool|skill|capability)\b/i,
  /\bwhenever\s+i\b[\s\S]{0,160}\b(?:automate|reuse|as a skill|as a tool)\b/i,
  /\bremember\s+(?:this|that)\s+as\s+a\s+(?:reusable\s+)?(?:skill|tool|capability)\b/i,
];

const FALSE_POSITIVES = [
  /\bcreate\s+a\s+(?:file|folder|directory|pr|pull request|commit|branch|issue)\b/i,
  /\bmake\s+a\s+(?:file|folder|commit|pr)\b/i,
];

export function detectsCapabilityCreateIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;
  if (FALSE_POSITIVES.some((re) => re.test(trimmed))) return false;
  return CREATE_INTENT.some((re) => re.test(trimmed));
}
