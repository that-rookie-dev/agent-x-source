import { describe, expect, it } from 'vitest';
import { extractActionableTaskTitles } from '../src/agent/extract-actionable-tasks.js';

describe('extractActionableTaskTitles', () => {
  it('does not treat summary / key-point bullets as tasks', () => {
    const content = [
      'Key points from your tax review:',
      '- April TDS already deducted: ₹41,056',
      '- New regime is the right call — saves ~₹2.07L',
      '- ₹2L/month net is solid take-home',
      '- Form 16 correctly shows the deductions',
    ].join('\n');
    expect(extractActionableTaskTitles(content)).toEqual([]);
  });

  it('accepts checkbox action items', () => {
    const content = [
      'Here is the plan:',
      '- [ ] Implement payroll export',
      '- [ ] Verify TDS challan amounts',
      '- Done already yesterday',
    ].join('\n');
    expect(extractActionableTaskTitles(content)).toEqual([
      'Implement payroll export',
      'Verify TDS challan amounts',
    ]);
  });

  it('accepts items under an Action items section with imperative verbs', () => {
    const content = [
      '## Action items',
      '1. Update the Form 16 worksheet',
      '2. Create a reminder for Q2 advance tax',
      '3. New regime is the right call',
    ].join('\n');
    expect(extractActionableTaskTitles(content)).toEqual([
      'Update the Form 16 worksheet',
      'Create a reminder for Q2 advance tax',
    ]);
  });

  it('accepts TODO: prefixed lines even in mixed prose', () => {
    const content = [
      'Summary looks fine overall.',
      'TODO: Fix the mismatch on line 42',
      'TODO: Run the regression suite',
    ].join('\n');
    expect(extractActionableTaskTitles(content)).toEqual([
      'Fix the mismatch on line 42',
      'Run the regression suite',
    ]);
  });
});
