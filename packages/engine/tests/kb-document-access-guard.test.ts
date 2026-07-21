import { describe, expect, it } from 'vitest';
import {
  blockKbDiskFallback,
  isKbDiskFallbackTool,
  type KbDocumentTurnPolicy,
} from '../src/knowledge-base/kb-document-access-guard.js';

describe('kb-document-access-guard', () => {
  const policy: KbDocumentTurnPolicy = {
    active: true,
    sourceIds: ['src-tax'],
    names: ['CG_TaxForecast_2026.pdf'],
  };

  it('blocks shell and file_read when KB policy is active', () => {
    expect(blockKbDiskFallback('shell_exec', policy)?.error).toBe('KB_DISK_FALLBACK_DENIED');
    expect(blockKbDiskFallback('file_read', policy)?.error).toBe('KB_DISK_FALLBACK_DENIED');
    expect(blockKbDiskFallback('python_rpc', policy)?.error).toBe('KB_DISK_FALLBACK_DENIED');
    expect(blockKbDiskFallback('glob', policy)?.error).toBe('KB_DISK_FALLBACK_DENIED');
  });

  it('allows knowledge_base_search and web tools', () => {
    expect(blockKbDiskFallback('knowledge_base_search', policy)).toBeNull();
    expect(blockKbDiskFallback('web_search', policy)).toBeNull();
    expect(blockKbDiskFallback('ask_clarification', policy)).toBeNull();
  });

  it('is inactive without policy', () => {
    expect(blockKbDiskFallback('shell_exec', null)).toBeNull();
    expect(isKbDiskFallbackTool('shell_exec')).toBe(true);
    expect(isKbDiskFallbackTool('knowledge_base_search')).toBe(false);
  });
});
