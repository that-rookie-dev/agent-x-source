import { describe, expect, it } from 'vitest';
import {
  formatStdioSpawnError,
  resolveStdioCommand,
  resetLoginShellPathForTests,
} from '../src/utils/host-path.js';

describe('host-path', () => {
  it('formats npx ENOENT with platform-aware install guidance', () => {
    const message = formatStdioSpawnError(new Error('spawn npx ENOENT'), 'npx');
    expect(message).toContain('Node.js/npx was not found');
    expect(message).toContain('Booking.com');
    expect(message).toMatch(/nodejs\.org/);
  });

  it('leaves absolute unix paths unchanged', () => {
    expect(resolveStdioCommand('/usr/local/bin/npx')).toBe('/usr/local/bin/npx');
  });

  it('leaves absolute windows paths unchanged', () => {
    expect(resolveStdioCommand('C:\\Program Files\\nodejs\\npx.cmd')).toBe('C:\\Program Files\\nodejs\\npx.cmd');
  });

  it('hydrates PATH without throwing on the current platform', () => {
    resetLoginShellPathForTests();
    expect(() => resolveStdioCommand('npx')).not.toThrow();
  });
});
