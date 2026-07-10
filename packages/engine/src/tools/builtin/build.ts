import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

type BuildSystem = 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'go' | 'make' | 'cmake' | 'tsc' | 'unknown';

function detectBuild(cwd: string): BuildSystem {
  if (existsSync(join(cwd, 'Makefile'))) return 'make';
  if (existsSync(join(cwd, 'CMakeLists.txt'))) return 'cmake';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
    const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
    if (typeof scripts.build === 'string' && String(scripts.build).includes('tsc')) return 'tsc';
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
    if (typeof scripts.build === 'string') return 'npm';
  } catch { /* ignore */ }
  if (existsSync(join(cwd, 'tsconfig.json'))) return 'tsc';
  return 'unknown';
}

function execCmd(cmd: string, cwd: string, timeout = 180000): ToolResult {
  try {
    // Clear Make jobserver flags — inherited MAKEFLAGS from CI/parent make can hang nested make.
    const env = { ...process.env, MAKEFLAGS: '', MFLAGS: '', MAKELEVEL: '' };
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim() || 'Build succeeded' };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'BUILD_FAILED' };
  }
}

export async function build(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const target = args['target'] as string | undefined;
  const release = args['release'] as boolean;
  const cwd = resolve(context.scopePath);
  const sys = detectBuild(cwd);

  switch (sys) {
    case 'cargo': return execCmd(`cargo build${release ? ' --release' : ''}`, cwd);
    case 'go': return execCmd(`go build${target ? ` -o ${target}` : ''} ./...`, cwd);
    case 'tsc': return execCmd('npx tsc --noEmit', cwd);
    case 'npm': return execCmd('npm run build', cwd);
    case 'pnpm': return execCmd('pnpm run build', cwd);
    case 'yarn': return execCmd('yarn build', cwd);
    case 'make': return execCmd(`make${target ? ` ${target}` : ''}`, cwd, 30_000);
    case 'cmake':
      execSync('mkdir -p build', { cwd });
      return execCmd('cmake --build build', cwd);
    default: return { success: false, output: 'Unknown build system. Use shell_exec instead.', error: 'UNSUPPORTED' };
  }
}

export async function buildRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const args_str = args['args'] as string | undefined;
  const release = args['release'] as boolean;
  const cwd = resolve(context.scopePath);
  const sys = detectBuild(cwd);

  switch (sys) {
    case 'cargo': return execCmd(`cargo run${release ? ' --release' : ''}${args_str ? ` -- ${args_str}` : ''}`, cwd);
    case 'go': return execCmd(`go run .${args_str ? ` ${args_str}` : ''}`, cwd);
    case 'npm': return execCmd(`npm start${args_str ? ` ${args_str}` : ''}`, cwd);
    case 'pnpm': return execCmd(`pnpm start${args_str ? ` ${args_str}` : ''}`, cwd);
    case 'yarn': return execCmd(`yarn start${args_str ? ` ${args_str}` : ''}`, cwd);
    case 'make': return execCmd(`make run${args_str ? ` ARGS="${args_str}"` : ''}`, cwd);
    default: return { success: false, output: 'Use shell_exec to run this project', error: 'UNSUPPORTED' };
  }
}

export async function buildCheck(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const sys = detectBuild(cwd);

  switch (sys) {
    case 'cargo': return execCmd('cargo check', cwd);
    case 'go': return execCmd('go vet ./...', cwd);
    case 'tsc': return execCmd('npx tsc --noEmit', cwd, 60000);
    case 'npm': return execCmd('npm run build', cwd);
    case 'pnpm': return execCmd('pnpm run build', cwd);
    case 'yarn': return execCmd('yarn build', cwd);
    default: return { success: false, output: 'Unknown build system', error: 'UNSUPPORTED' };
  }
}

export async function buildClean(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const sys = detectBuild(cwd);

  switch (sys) {
    case 'cargo': return execCmd('cargo clean', cwd, 60000);
    case 'go': return execCmd('go clean -cache', cwd, 60000);
    case 'tsc': case 'npm': case 'pnpm': case 'yarn': {
      try { execSync('rm -rf dist build node_modules/.cache', { cwd }); } catch { /* ignore */ }
      return { success: true, output: 'Cleaned build artifacts' };
    }
    case 'make': return execCmd('make clean', cwd, 60000);
    default: return { success: true, output: 'No build artifacts to clean' };
  }
}
