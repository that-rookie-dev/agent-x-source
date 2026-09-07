import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { CapabilitySandboxResult, SyntheticIntelligenceConfig } from '@agentx/shared';
import { DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG } from '@agentx/shared';
import type { Sandbox } from '@agentx/shared';
import { NamespaceSandbox } from '../sandbox/NamespaceSandbox.js';
import { DefaultCapabilityGenerator } from './CapabilityGenerator.js';
import { transformSync } from 'esbuild';
import type { CapabilitySandbox } from './interfaces.js';
import { siMetrics } from './si-metrics.js';

export interface SandboxManagerOptions {
  defaultTimeoutMs?: number;
  maxOutputSize?: number;
  concurrentLimit?: number;
  dailyBudgetMs?: number;
}

const liveTempDirs = new Set<string>();
let exitHook = false;

function ensureExitCleanup(): void {
  if (exitHook) return;
  exitHook = true;
  const wipe = () => {
    for (const dir of liveTempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    liveTempDirs.clear();
  };
  process.once('exit', wipe);
  process.once('SIGINT', wipe);
  process.once('SIGTERM', wipe);
}

function sanitizeArgs(args: Record<string, unknown>, maxBytes = 32_768): Record<string, unknown> {
  let raw = '';
  try {
    raw = JSON.stringify(args ?? {});
  } catch {
    return {};
  }
  raw = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (raw.length > maxBytes) {
    throw new Error(`Sandbox arguments exceed ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} bytes]`;
}

function stripBinary(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Process-isolated sandbox for generated tools.
 * Uses the bundled NamespaceSandbox (tempdir + timeout + no-network child process).
 * Never constructs DockerSandbox — Agent-X is an install-and-use bundle.
 */
export class SandboxManager implements CapabilitySandbox {
  private sandbox: Sandbox;
  private analyzer = new DefaultCapabilityGenerator(null);
  private queue: Array<() => void> = [];
  private inflight = 0;
  private spentTodayMs = 0;
  private spentDayKey = utcDayKey();
  private readonly timeoutMs: number;
  private readonly maxOutputSize: number;
  private readonly concurrentLimit: number;
  private readonly dailyBudgetMs: number;
  private readonly mode: SyntheticIntelligenceConfig['sandboxMode'];

  constructor(
    mode: SyntheticIntelligenceConfig['sandboxMode'] = 'process',
    sandbox?: Sandbox,
    options: SandboxManagerOptions = {},
  ) {
    this.mode = mode === 'disabled' ? 'disabled' : 'process';
    this.sandbox = sandbox ?? new NamespaceSandbox([tmpdir()], [process.cwd()]);
    ensureExitCleanup();
    this.timeoutMs = options.defaultTimeoutMs ?? DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG.sandboxTimeoutMs;
    this.maxOutputSize = options.maxOutputSize ?? 1_000_000;
    this.concurrentLimit = options.concurrentLimit ?? DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG.concurrentSandboxLimit;
    this.dailyBudgetMs = options.dailyBudgetMs ?? DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG.dailySandboxBudgetMs;
  }

  async runTool(code: string, language: string, args: Record<string, unknown>, entryPoint = 'run'): Promise<CapabilitySandboxResult> {
    if (this.mode === 'disabled') {
      return {
        passed: false,
        stdout: '',
        stderr: 'Sandbox is disabled',
        exitCode: -1,
        warnings: ['sandbox-disabled'],
        detectedSideEffects: this.analyzer.detectSideEffects(code, language),
        executionTimeMs: 0,
      };
    }
    await this.acquire();
    const start = Date.now();
    const dir = join(tmpdir(), `agentx-si-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    liveTempDirs.add(dir);
    const abort = new AbortController();
    const killer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      this.assertDailyBudget();
      const safeArgs = sanitizeArgs(args);
      const { filename, command } = this.prepare(dir, language);
      writeFileSync(filename, this.wrap(code, language, safeArgs, entryPoint), 'utf8');
      if (abort.signal.aborted) {
        throw new Error('Sandbox timeout');
      }
      const result = await this.sandbox.exec(command, {
        cwd: dir,
        timeout: this.timeoutMs,
        networkAccess: false,
        memoryLimit: 64,
      });
      const elapsed = result.duration ?? (Date.now() - start);
      this.noteSpend(elapsed);
      const warnings = this.analyzer.detectSideEffects(code, language);
      const stdout = truncate(stripBinary(result.stdout ?? ''), this.maxOutputSize);
      const stderr = truncate(stripBinary(result.stderr ?? ''), this.maxOutputSize);
      return {
        passed: result.exitCode === 0 && !result.error,
        stdout,
        stderr: result.error && !stderr ? result.error : stderr,
        exitCode: result.exitCode,
        warnings,
        detectedSideEffects: warnings,
        executionTimeMs: elapsed,
      };
    } catch (err) {
      return {
        passed: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: -1,
        warnings: ['sandbox-exception'],
        detectedSideEffects: [],
        executionTimeMs: Date.now() - start,
      };
    } finally {
      clearTimeout(killer);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      liveTempDirs.delete(dir);
      this.release();
    }
  }

  async validateSideEffects(code: string, language: string): Promise<string[]> {
    return this.analyzer.detectSideEffects(code, language);
  }

  async estimateRisk(code: string, language: string): Promise<'low' | 'medium' | 'high'> {
    return this.analyzer.estimateRisk(code, language);
  }

  private prepare(dir: string, language: string): { filename: string; command: string } {
    if (language === 'python') {
      const filename = join(dir, 'tool.py');
      return { filename, command: `python3 ${JSON.stringify(filename)}` };
    }
    if (language === 'bash') {
      const filename = join(dir, 'tool.sh');
      return { filename, command: `bash ${JSON.stringify(filename)}` };
    }
    const filename = join(dir, 'tool.mjs');
    return { filename, command: `node ${JSON.stringify(filename)}` };
  }

  private wrap(code: string, language: string, args: Record<string, unknown>, entryPoint: string): string {
    const payload = JSON.stringify(args);
    if (language === 'python') {
      return `${code}\nimport json\nargs = json.loads(${JSON.stringify(payload)})\nfn = globals().get(${JSON.stringify(entryPoint)}) or globals().get('run') or globals().get('main')\nif fn is None:\n    raise SystemExit('missing entryPoint')\nprint(json.dumps(fn(args), default=str))\n`;
    }
    if (language === 'bash') {
      return `${code}\n`;
    }
    let runnable = code;
    if (language === 'typescript') {
      try {
        const result = transformSync(code, {
          loader: 'ts',
          target: 'node20',
          format: 'esm',
          platform: 'node',
        });
        runnable = result.code;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`TypeScript transpile failed: ${msg}`);
      }
    }
    return `${runnable}\nconst args = ${payload};\nconst fn = (typeof ${entryPoint} === 'function' ? ${entryPoint} : (typeof run === 'function' ? run : (typeof main === 'function' ? main : null)));\nif (!fn) { console.error('missing entryPoint'); process.exit(1); }\nPromise.resolve(fn(args)).then((r) => { console.log(typeof r === 'string' ? r : JSON.stringify(r)); }).catch((e) => { console.error(e); process.exit(1); });\n`;
  }

  private acquire(): Promise<void> {
    if (this.inflight < this.concurrentLimit) {
      this.inflight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      siMetrics.increment('queue', true);
      this.queue.push(() => {
        this.inflight += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  private assertDailyBudget(): void {
    this.rollDay();
    if (this.dailyBudgetMs > 0 && this.spentTodayMs >= this.dailyBudgetMs) {
      throw new Error('Daily sandbox execution budget exhausted');
    }
  }

  private noteSpend(ms: number): void {
    this.rollDay();
    this.spentTodayMs += Math.max(0, ms);
  }

  private rollDay(): void {
    const key = utcDayKey();
    if (key !== this.spentDayKey) {
      this.spentDayKey = key;
      this.spentTodayMs = 0;
    }
  }
}

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** @deprecated Process isolation only — never Docker. Kept so existing imports compile. */
export class DockerCapabilitySandbox extends SandboxManager {}

export { SandboxManager as ProcessCapabilitySandbox };
