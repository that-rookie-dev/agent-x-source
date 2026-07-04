import { describe, expect, it } from 'vitest';
import { generateAxId, isAxId, parseAxId } from '../src/utils/ax-id.js';

describe('ax-id', () => {
  it('generates ax_auto_<alphanumeric> ids', () => {
    const id = generateAxId('auto');
    expect(id).toMatch(/^ax_auto_[a-zA-Z0-9]{12}$/);
    expect(isAxId(id, 'auto')).toBe(true);
    expect(isAxId(id, 'run')).toBe(false);
  });

  it('generates ax_run ids', () => {
    const id = generateAxId('run', 10);
    expect(id).toMatch(/^ax_run_[a-zA-Z0-9]{10}$/);
    expect(parseAxId(id)).toEqual({ entity: 'run', suffix: id.slice('ax_run_'.length) });
  });

  it('rejects invalid ax ids', () => {
    expect(isAxId('automation:uuid')).toBe(false);
    expect(isAxId('ax_auto_bad-chars!')).toBe(false);
    expect(parseAxId('not-an-ax-id')).toBeNull();
  });
});
