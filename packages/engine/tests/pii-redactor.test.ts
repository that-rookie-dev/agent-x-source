import { describe, it, expect } from 'vitest';
import { PiiRedactor } from '../src/neural/PiiRedactor.js';

describe('PiiRedactor', () => {
  it('redacts dash-separated credit cards', async () => {
    const r = new PiiRedactor({ enabled: true });
    const out = await r.redact('Card 4111-1111-1111-1111 on file');
    expect(out.touched).toBe(true);
    expect(out.redacted).toContain('{{VAULT:CREDIT_CARD:');
    expect(out.redacted).not.toContain('4111-1111-1111-1111');
  });

  it('does not treat space-separated payroll amounts as credit cards', async () => {
    const r = new PiiRedactor({ enabled: true });
    const payroll = 'COMMUNICATION A 5619 5619 5619 5619 5619 5619 5619 5619 5619 5619 5619 5619 67428';
    const out = await r.redact(payroll);
    expect(out.redacted).toBe(payroll);
    expect(out.redacted).not.toContain('VAULT:CREDIT_CARD');
  });
});
