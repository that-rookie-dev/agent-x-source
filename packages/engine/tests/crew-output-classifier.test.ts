import { describe, it, expect } from 'vitest';
import { outputNeedsClarification } from '../src/agent/crew-output-classifier.js';

describe('outputNeedsClarification', () => {
  it('does not flag long deliverables with tip-style question marks', () => {
    const plan = `# Your Daily Healthy Life Routine

## Sleep
**Why it matters:** Sleep is when your body repairs.

- Tip? Adjust intensity. Not hungry at breakfast?
- Tip? Shift meal timing. Flexibility is strength.

## Food
Eat whole foods and stay hydrated.`;
    expect(outputNeedsClarification(plan.repeat(20))).toBe(false);
  });

  it('flags explicit clarification requests', () => {
    expect(outputNeedsClarification('I need more information before I can proceed. Could you clarify your goal?')).toBe(true);
    expect(outputNeedsClarification('Please specify which diet you prefer: vegan or omnivore?')).toBe(true);
  });

  it('flags short direct questions', () => {
    expect(outputNeedsClarification('Which option would you like?\nA or B?')).toBe(true);
    expect(outputNeedsClarification('What is your target weight?')).toBe(true);
  });
});
