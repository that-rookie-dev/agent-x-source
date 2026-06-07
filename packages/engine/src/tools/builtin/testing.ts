import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

type TestRunner = 'vitest' | 'jest' | 'pytest' | 'cargo-test' | 'go-test' | 'unknown';

function detectTestRunner(cwd: string): TestRunner {
  if (existsSync(join(cwd, 'vitest.config.ts')) || existsSync(join(cwd, 'vitest.config.js')))
    return 'vitest';
  if (existsSync(join(cwd, 'jest.config.ts')) || existsSync(join(cwd, 'jest.config.js')) || existsSync(join(cwd, 'jest.config.json')))
    return 'jest';
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
    const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
    if (typeof scripts.test === 'string' && String(scripts.test).includes('vitest'))
      return 'vitest';
    if (typeof scripts.test === 'string' && String(scripts.test).includes('jest'))
      return 'jest';
  } catch { /* ignore */ }
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'setup.cfg')))
    return 'pytest';
  if (existsSync(join(cwd, 'Cargo.toml')))
    return 'cargo-test';
  if (existsSync(join(cwd, 'go.mod')))
    return 'go-test';
  return 'unknown';
}

function execCmd(cmd: string, cwd: string, timeout = 120000): ToolResult {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'TEST_FAILED' };
  }
}

export async function testRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string | undefined;
  const pattern = args['pattern'] as string | undefined;
  const cwd = resolve(context.scopePath);
  const runner = detectTestRunner(cwd);

  switch (runner) {
    case 'vitest': {
      let cmd = 'npx vitest run --reporter=verbose';
      if (file) cmd += ` ${file}`;
      if (pattern) cmd += ` -t "${pattern}"`;
      return execCmd(cmd, cwd);
    }
    case 'jest': {
      let cmd = 'npx jest --verbose';
      if (file) cmd += ` ${file}`;
      if (pattern) cmd += ` -t "${pattern}"`;
      return execCmd(cmd, cwd);
    }
    case 'pytest': {
      let cmd = 'python -m pytest -v';
      if (file) cmd += ` ${file}`;
      if (pattern) cmd += ` -k "${pattern}"`;
      return execCmd(cmd, cwd);
    }
    case 'cargo-test': {
      let cmd = 'cargo test';
      if (pattern) cmd += ` ${pattern}`;
      return execCmd(cmd, cwd);
    }
    case 'go-test': {
      let cmd = 'go test -v';
      if (pattern) cmd += ` -run "${pattern}"`;
      if (file) cmd = `go test -v ${file}`;
      return execCmd(cmd, cwd);
    }
    default: return execCmd('npm test', cwd);
  }
}

export async function testWatch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string | undefined;
  const cwd = resolve(context.scopePath);
  const runner = detectTestRunner(cwd);

  switch (runner) {
    case 'vitest': return execCmd(`npx vitest${file ? ` ${file}` : ''} --reporter=verbose --run`, cwd, 60000);
    case 'jest': return execCmd(`npx jest${file ? ` ${file}` : ''} --verbose`, cwd, 60000);
    case 'pytest': return execCmd(`python -m pytest${file ? ` ${file}` : ''} -v`, cwd, 60000);
    case 'cargo-test': return execCmd(`cargo test`, cwd, 60000);
    case 'go-test': return execCmd(`go test -v ${file ?? './...'}`, cwd, 60000);
    default: return execCmd('npm test', cwd, 60000);
  }
}

export async function testCoverage(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const runner = detectTestRunner(cwd);

  switch (runner) {
    case 'vitest': return execCmd('npx vitest run --coverage --reporter=verbose', cwd, 180000);
    case 'jest': return execCmd('npx jest --coverage --verbose', cwd, 180000);
    case 'pytest': return execCmd('python -m pytest --cov=. --cov-report=term', cwd, 180000);
    case 'cargo-test': return execCmd('cargo llvm-cov --lcov --output-path coverage.lcov 2>/dev/null || cargo test', cwd, 180000);
    case 'go-test': return execCmd('go test -coverprofile=coverage.out ./...', cwd, 180000);
    default: return { success: false, output: 'Coverage not available for this project', error: 'UNSUPPORTED' };
  }
}

export async function testCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const sourceFile = args['sourceFile'] as string;
  const sourcePath = resolve(context.scopePath, sourceFile);

  if (!existsSync(sourcePath)) return { success: false, output: 'Source file not found', error: 'NOT_FOUND' };

  const content = readFileSync(sourcePath, 'utf-8');
  const dir = dirname(sourcePath);
  const name = basename(sourcePath).replace(/\.(ts|tsx|js|jsx|py|rs|go)$/, '');
  const ext = basename(sourcePath).split('.').pop();

  if (ext === 'py') {
    const testDir = join(dir, 'tests');
    const testFile = join(testDir, `test_${name}.py`);
    if (existsSync(testFile)) return { success: false, output: `Test file already exists: ${testFile}`, error: 'EXISTS' };
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, `import pytest\nfrom ${name} import *  # noqa: F403\n\n\ndef test_${name}():\n    """TODO: implement test"""\n    pass\n`, 'utf-8');
    return { success: true, output: `Created test file: ${testFile}`, metadata: { testFile } };
  }

  if (ext === 'rs') {
    const testFile = join(dir, `${name}_test.rs`);
    if (existsSync(testFile)) return { success: false, output: `Test already exists`, error: 'EXISTS' };
    writeFileSync(testFile, `#[cfg(test)]\nmod tests {\n    #[test]\n    fn test_${name}() {\n        // TODO: implement test\n    }\n}\n`, 'utf-8');
    return { success: true, output: `Created test file: ${testFile}`, metadata: { testFile } };
  }

  // Default: vitest
  const exports = content.match(/export\s+(?:function|class|const|interface|type)\s+(\w+)/g) ?? [];
  const names = exports.map((e) => e.replace(/export\s+(?:function|class|const|interface|type)\s+/, ''));
  const testDir = join(dir, '__tests__');
  const testFile = join(testDir, `${name}.test.ts`);

  if (existsSync(testFile)) return { success: false, output: `Test file already exists: ${testFile}`, error: 'EXISTS' };

  let testContent = `import { describe, it, expect } from 'vitest';\n`;
  if (names.length > 0) testContent += `import { ${names.join(', ')} } from '../${name}.js';\n`;
  testContent += '\n';
  for (const n of names) {
    testContent += `describe('${n}', () => {\n  it('should work', () => {\n    expect(${n}).toBeDefined();\n  });\n});\n\n`;
  }
  if (names.length === 0) {
    testContent += `describe('${name}', () => {\n  it('should work', () => {\n    // TODO: implement test\n    expect(true).toBe(true);\n  });\n});\n`;
  }
  mkdirSync(testDir, { recursive: true });
  writeFileSync(testFile, testContent, 'utf-8');
  return { success: true, output: `Created test file: ${testFile}`, metadata: { testFile, exports: names } };
}

export async function benchmarkRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string | undefined;
  const cwd = resolve(context.scopePath);
  const runner = detectTestRunner(cwd);

  switch (runner) {
    case 'vitest': return execCmd(`npx vitest bench --reporter=verbose${file ? ` ${file}` : ''}`, cwd);
    case 'cargo-test': return execCmd(`cargo bench${file ? ` -- ${file}` : ''}`, cwd);
    case 'go-test': return execCmd(`go test -bench=. ${file ?? './...'}`, cwd);
    case 'pytest': return execCmd(`python -m pytest --benchmark-only${file ? ` ${file}` : ''}`, cwd);
    default: return { success: false, output: 'Benchmarks not available for this project', error: 'UNSUPPORTED' };
  }
}
