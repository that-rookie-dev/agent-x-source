import { describe, expect, it } from 'vitest';
import { isMcpToolResultError } from '../src/integrations/mcp/mcp-result.js';

describe('isMcpToolResultError', () => {
  it('detects isError flag on MCP payload', () => {
    expect(isMcpToolResultError({ isError: true, content: [] }, 'something failed')).toBe(true);
  });

  it('detects APIResponseError in formatted output', () => {
    expect(
      isMcpToolResultError(
        { content: [{ type: 'text', text: 'APIResponseError: validation failed' }] },
        'APIResponseError: validation failed',
      ),
    ).toBe(true);
  });

  it('detects MCP protocol errors', () => {
    expect(isMcpToolResultError({}, 'MCP error -32602: Invalid arguments')).toBe(true);
  });

  it('returns false for successful search output', () => {
    expect(isMcpToolResultError({ isError: false }, 'Found 2 files:\nfoo.pdf (application/pdf)')).toBe(false);
  });
});
