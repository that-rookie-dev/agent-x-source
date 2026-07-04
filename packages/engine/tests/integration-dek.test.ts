import { describe, expect, it } from 'vitest';
import { resolveIntegrationDek } from '../src/integrations/oauth/integration-dek.js';

describe('resolveIntegrationDek', () => {
  it('prefers AGENTX_VAULT_KEY over auth DEK', () => {
    const machine = Buffer.alloc(32, 7).toString('base64');
    const auth = Buffer.alloc(32, 3);
    process.env['AGENTX_VAULT_KEY'] = machine;
    try {
      expect(resolveIntegrationDek(auth)?.equals(Buffer.alloc(32, 7))).toBe(true);
    } finally {
      delete process.env['AGENTX_VAULT_KEY'];
    }
  });

  it('falls back to auth DEK when machine key is absent', () => {
    delete process.env['AGENTX_VAULT_KEY'];
    const auth = Buffer.alloc(32, 9);
    expect(resolveIntegrationDek(auth)).toBe(auth);
  });

  it('returns null when no keys are available', () => {
    delete process.env['AGENTX_VAULT_KEY'];
    expect(resolveIntegrationDek(null)).toBeNull();
  });
});
