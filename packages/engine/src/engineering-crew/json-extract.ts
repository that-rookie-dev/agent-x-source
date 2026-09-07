/**
 * Best-effort extraction of a JSON object from an LLM completion, which commonly wraps JSON in
 * markdown code fences or adds prose before/after it.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((s): s is string => !!s);
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try to find the first balanced {...} block within the candidate.
      const start = trimmed.indexOf('{');
      if (start === -1) continue;
      let depth = 0;
      for (let i = start; i < trimmed.length; i++) {
        if (trimmed[i] === '{') depth++;
        else if (trimmed[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(trimmed.slice(start, i + 1));
              if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
            } catch { /* keep scanning */ }
            break;
          }
        }
      }
    }
  }
  return null;
}
