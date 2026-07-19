import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { platform } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  buildStdioEnv,
  formatStdioSpawnError,
  resolveStdioCommand,
  resetLoginShellPathForTests,
} from '../src/utils/host-path.js';
import { applyMcpBrowserLaunchEnv, ensureOpenBrowserShimDir } from '../src/utils/open-browser.js';

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

  it('applies MCP browser launch env for all stdio MCP clients', () => {
    const shimDir = ensureOpenBrowserShimDir();
    if (platform() === 'darwin' || platform() === 'linux' || platform() === 'win32') {
      expect(shimDir).toBeTruthy();
      expect(existsSync(join(shimDir!, platform() === 'win32' ? 'agentx-open-url.cmd' : 'agentx-open-url'))).toBe(true);
      if (platform() === 'darwin') {
        expect(existsSync(join(shimDir!, 'open'))).toBe(true);
      }
      if (platform() === 'linux') {
        expect(existsSync(join(shimDir!, 'xdg-open'))).toBe(true);
      }
    }

    const env = applyMcpBrowserLaunchEnv({ PATH: '/usr/bin', FOO: 'bar' });
    expect(env.FOO).toBe('bar');
    if (shimDir) {
      expect(env.PATH?.startsWith(`${shimDir}${delimiter}`)).toBe(true);
      expect(env.BROWSER).toContain('agentx-open-url');
    }

    const stdioEnv = buildStdioEnv({ CUSTOM: '1' });
    expect(stdioEnv.CUSTOM).toBe('1');
    if (shimDir) {
      expect(stdioEnv.BROWSER).toContain('agentx-open-url');
      expect(stdioEnv.PATH?.startsWith(`${shimDir}${delimiter}`) || stdioEnv.PATH === shimDir).toBe(true);
    }
  });
});
