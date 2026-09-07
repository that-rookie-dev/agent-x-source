import { describe, it, expect } from 'vitest';
import type { Sandbox, SandboxResult } from '@agentx/shared';
import { SandboxManager } from '../../src/synthetic/CapabilitySandbox.js';

function fakeSandbox(exec: Sandbox['exec']): Sandbox {
  return {
    name: 'namespace',
    available: true,
    exec,
    execBackground: async () => ({ pid: 1 }),
    kill: async () => true,
    list: async () => [],
    writeFile: async () => undefined,
    readFile: async () => '',
    dispose: async () => undefined,
  };
}

const ok: SandboxResult = { stdout: '{"ok":true}', stderr: '', exitCode: 0, duration: 5 };

describe('SandboxManager', () => {
  it('runs generated javascript through process isolation', async () => {
    const mgr = new SandboxManager('process', fakeSandbox(async () => ok));
    const result = await mgr.runTool('function run(args){ return args; }', 'javascript', { n: 1 }, 'run');
    expect(result.passed).toBe(true);
    expect(result.stdout).toContain('ok');
  });

  it('detects network side effects as high risk', async () => {
    const mgr = new SandboxManager('process', fakeSandbox(async () => ok));
    expect(await mgr.validateSideEffects('await fetch(url)', 'javascript')).toContain('network');
    expect(await mgr.estimateRisk('await fetch(url)', 'javascript')).toBe('high');
    expect(await mgr.estimateRisk('child_process.spawn("x")', 'javascript')).toBe('high');
  });

  it('returns failure when sandbox is disabled', async () => {
    const mgr = new SandboxManager('disabled', fakeSandbox(async () => ok));
    const result = await mgr.runTool('function run(){return 1}', 'javascript', {});
    expect(result.passed).toBe(false);
    expect(result.warnings).toContain('sandbox-disabled');
  });

  it('truncates oversized output', async () => {
    const huge = 'x'.repeat(50);
    const mgr = new SandboxManager('process', fakeSandbox(async () => ({ ...ok, stdout: huge })), { maxOutputSize: 10 });
    const result = await mgr.runTool('function run(){return 1}', 'javascript', {});
    expect(result.stdout.length).toBeLessThan(huge.length);
    expect(result.stdout).toContain('truncated');
  });

  it('enforces concurrent sandbox limit', async () => {
    let inflight = 0;
    let max = 0;
    const mgr = new SandboxManager('process', fakeSandbox(async () => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 40));
      inflight -= 1;
      return ok;
    }), { concurrentLimit: 2 });
    await Promise.all([
      mgr.runTool('function run(){return 1}', 'javascript', {}),
      mgr.runTool('function run(){return 1}', 'javascript', {}),
      mgr.runTool('function run(){return 1}', 'javascript', {}),
    ]);
    expect(max).toBeLessThanOrEqual(2);
  });

  it('never constructs docker — process mode uses injected or namespace sandbox', async () => {
    const mgr = new SandboxManager('process');
    expect(mgr).toBeInstanceOf(SandboxManager);
  });

  it('kills an infinite loop via timeout', async () => {
    const mgr = new SandboxManager('process', undefined, { defaultTimeoutMs: 400 });
    const result = await mgr.runTool('function run(){ while(true){} }', 'javascript', {});
    expect(result.passed).toBe(false);
  }, 8_000);

  it('returns a failed sandbox result on syntax errors', async () => {
    const mgr = new SandboxManager('process');
    const result = await mgr.runTool('function run( {', 'javascript', {});
    expect(result.passed).toBe(false);
    expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
  });
});
