/** Detect MCP tool payloads that report failure inside a nominally successful response. */
export function isMcpToolResultError(result: unknown, formattedOutput: string): boolean {
  if (result && typeof result === 'object') {
    const payload = result as { isError?: boolean };
    if (payload.isError === true) return true;
  }

  const lower = formattedOutput.toLowerCase();
  if (lower.includes('apiresponseerror')) return true;
  if (lower.includes('mcp error -')) return true;
  if (/\bvalidation error\b/i.test(formattedOutput)) return true;
  if (/\berror:\s*\d{3}\b/i.test(formattedOutput) && /\bfailed\b/i.test(formattedOutput)) return true;

  return false;
}
