/**
 * Strip MCP/SDK wrapper noise so the store UI can show the real server message.
 */
export function cleanMcpErrorMessage(raw: unknown, maxLen = 480): string {
  let text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  text = text.split('\u0000').join('').trim();
  if (!text) return 'Unknown MCP error';

  // Prefer nested JSON message when the payload is structured.
  const jsonMatch = text.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const nested =
        (typeof parsed.message === 'string' && parsed.message)
        || (typeof parsed.error === 'string' && parsed.error)
        || (typeof parsed.detail === 'string' && parsed.detail)
        || (typeof parsed.msg === 'string' && parsed.msg);
      if (nested) text = nested;
    } catch {
      /* keep original */
    }
  }

  text = text
    .replace(/^MCP error\s*-?\d+\s*:\s*/i, '')
    .replace(/^Error\s*:\s*/i, '')
    .replace(/^INTEGRATION_TOOL_FAILED\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLen) {
    return `${text.slice(0, maxLen - 1)}…`;
  }
  return text || 'Unknown MCP error';
}
