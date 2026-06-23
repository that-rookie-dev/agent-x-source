/** Rough token estimate when providers omit usage metadata (~4 chars/token). */
export function estimateTokensFromText(text: string): number {
  const len = text?.length ?? 0;
  return len > 0 ? Math.ceil(len / 4) : 0;
}

export function estimateTokensFromMessages(
  msgs: Array<{ role?: string; content?: string; tokenCount?: number }>,
): { total: number; input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const m of msgs) {
    const role = m.role ?? '';
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    const count = (m.tokenCount ?? 0) > 0
      ? (m.tokenCount as number)
      : estimateTokensFromText(m.content ?? '');
    if (role === 'assistant') output += count;
    else input += count;
  }
  return { total: input + output, input, output };
}
