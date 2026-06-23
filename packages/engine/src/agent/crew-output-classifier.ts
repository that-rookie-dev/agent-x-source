/**
 * Detect whether a crew worker output is asking the user for clarification,
 * vs. a deliverable that happens to contain question marks (e.g. "Tip? Adjust intensity").
 */
export function outputNeedsClarification(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (/(?:^|\n)\s*(?:i need (?:more|additional) (?:info|information|details|context)|(?:could|can) you (?:please )?(?:clarify|specify|confirm|tell me)|please (?:clarify|specify|let me know)|need clarification|before i can (?:proceed|continue)|which (?:one|option) (?:would|should|do) you)/im.test(lower)) {
    return true;
  }

  // Short reply that is mostly direct questions back to the user
  if (trimmed.length <= 500) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const questionLines = lines.filter((l) => /\?\s*$/.test(l));
    if (questionLines.length > 0 && questionLines.length >= Math.max(1, lines.length - 1)) {
      return true;
    }
    if (/\?\s*$/.test(trimmed) && trimmed.length < 300) {
      return true;
    }
  }

  return false;
}
