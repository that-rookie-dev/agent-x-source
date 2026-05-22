import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function testRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string | undefined;
  const pattern = args['pattern'] as string | undefined;
  const cwd = resolve(context.scopePath);

  let cmd = 'npx vitest run --reporter=verbose';
  if (file) cmd += ` ${file}`;
  if (pattern) cmd += ` -t "${pattern}"`;

  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'TEST_FAILED' };
  }
}

export async function testWatch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string | undefined;
  const cwd = resolve(context.scopePath);

  let cmd = 'npx vitest --reporter=verbose';
  if (file) cmd += ` ${file}`;

  try {
    const output = execSync(cmd + ' --run', { cwd, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; message: string };
    return { success: false, output: err.stdout ?? err.message, error: 'TEST_ERROR' };
  }
}

export async function testCoverage(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);

  try {
    const output = execSync('npx vitest run --coverage --reporter=verbose', {
      cwd,
      encoding: 'utf-8',
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; message: string };
    return { success: false, output: err.stdout ?? err.message, error: 'COVERAGE_ERROR' };
  }
}

export async function testCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const sourceFile = args['sourceFile'] as string;
  const sourcePath = resolve(context.scopePath, sourceFile);
  const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs');
  const { dirname, basename, join } = await import('node:path');

  if (!existsSync(sourcePath)) {
    return { success: false, output: 'Source file not found', error: 'NOT_FOUND' };
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const dir = dirname(sourcePath);
  const name = basename(sourcePath).replace(/\.(ts|tsx|js|jsx)$/, '');
  const testDir = join(dir, '__tests__');
  const testFile = join(testDir, `${name}.test.ts`);

  if (existsSync(testFile)) {
    return { success: false, output: `Test file already exists: ${testFile}`, error: 'EXISTS' };
  }

  // Extract exports for test scaffold
  const exports = content.match(/export\s+(?:function|class|const|interface|type)\s+(\w+)/g) ?? [];
  const names = exports.map((e) => e.replace(/export\s+(?:function|class|const|interface|type)\s+/, ''));

  let testContent = `import { describe, it, expect } from 'vitest';\n`;
  testContent += `import { ${names.join(', ')} } from '../${name}.js';\n\n`;

  for (const n of names) {
    testContent += `describe('${n}', () => {\n`;
    testContent += `  it('should work', () => {\n`;
    testContent += `    // TODO: implement test\n`;
    testContent += `    expect(${n}).toBeDefined();\n`;
    testContent += `  });\n`;
    testContent += `});\n\n`;
  }

  mkdirSync(testDir, { recursive: true });
  writeFileSync(testFile, testContent, 'utf-8');

  return { success: true, output: `Created test file: ${testFile}`, metadata: { testFile, exports: names } };
}
