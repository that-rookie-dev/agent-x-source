import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

interface ProjectInfo {
  name: string;
  language: string[];
  framework: string[];
  packageManager: string | null;
  buildTool: string | null;
  testFramework: string | null;
  entryPoint: string | null;
}

export async function projectDetect(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const root = resolve(context.scopePath);
  const info: ProjectInfo = {
    name: root.split('/').pop() ?? 'unknown',
    language: [],
    framework: [],
    packageManager: null,
    buildTool: null,
    testFramework: null,
    entryPoint: null,
  };

  const exists = (f: string) => existsSync(join(root, f));
  const readJson = (f: string) => {
    try { return JSON.parse(readFileSync(join(root, f), 'utf-8')); }
    catch { return null; }
  };

  // Package manager detection
  if (exists('pnpm-lock.yaml') || exists('pnpm-workspace.yaml')) info.packageManager = 'pnpm';
  else if (exists('yarn.lock')) info.packageManager = 'yarn';
  else if (exists('bun.lockb')) info.packageManager = 'bun';
  else if (exists('package-lock.json')) info.packageManager = 'npm';
  else if (exists('Cargo.toml')) info.packageManager = 'cargo';
  else if (exists('go.mod')) info.packageManager = 'go';
  else if (exists('requirements.txt') || exists('pyproject.toml')) info.packageManager = 'pip';

  // Language detection
  if (exists('tsconfig.json')) info.language.push('TypeScript');
  if (exists('package.json')) info.language.push('JavaScript');
  if (exists('Cargo.toml')) info.language.push('Rust');
  if (exists('go.mod')) info.language.push('Go');
  if (exists('pyproject.toml') || exists('setup.py') || exists('requirements.txt')) info.language.push('Python');
  if (exists('Gemfile')) info.language.push('Ruby');
  if (exists('pom.xml') || exists('build.gradle')) info.language.push('Java');

  // Framework + build + test detection from package.json
  const pkg = readJson('package.json');
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    // Frameworks
    if (allDeps['next']) info.framework.push('Next.js');
    if (allDeps['react']) info.framework.push('React');
    if (allDeps['vue']) info.framework.push('Vue');
    if (allDeps['svelte']) info.framework.push('Svelte');
    if (allDeps['express']) info.framework.push('Express');
    if (allDeps['fastify']) info.framework.push('Fastify');
    if (allDeps['hono']) info.framework.push('Hono');
    if (allDeps['electron']) info.framework.push('Electron');
    if (allDeps['ink']) info.framework.push('Ink');
    // Build tools
    if (allDeps['tsup']) info.buildTool = 'tsup';
    else if (allDeps['vite']) info.buildTool = 'Vite';
    else if (allDeps['webpack']) info.buildTool = 'webpack';
    else if (allDeps['esbuild']) info.buildTool = 'esbuild';
    else if (allDeps['rollup']) info.buildTool = 'Rollup';
    else if (allDeps['turbo']) info.buildTool = 'Turborepo';
    // Test frameworks
    if (allDeps['vitest']) info.testFramework = 'Vitest';
    else if (allDeps['jest']) info.testFramework = 'Jest';
    else if (allDeps['mocha']) info.testFramework = 'Mocha';
    else if (allDeps['ava']) info.testFramework = 'Ava';
    // Entry point
    if (pkg.main) info.entryPoint = pkg.main;
    else if (pkg.module) info.entryPoint = pkg.module;
    // Name
    if (pkg.name) info.name = pkg.name;
  }

  // Rust
  const cargo = readJson('Cargo.toml');
  if (cargo) {
    info.buildTool = 'cargo';
    info.testFramework = 'cargo test';
  }

  // Python
  if (exists('pyproject.toml')) {
    const pyproj = readFileSync(join(root, 'pyproject.toml'), 'utf-8');
    if (pyproj.includes('pytest')) info.testFramework = 'pytest';
    if (pyproj.includes('django')) info.framework.push('Django');
    if (pyproj.includes('fastapi')) info.framework.push('FastAPI');
    if (pyproj.includes('flask')) info.framework.push('Flask');
  }

  // Docker
  if (exists('Dockerfile') || exists('docker-compose.yml') || exists('docker-compose.yaml')) {
    info.framework.push('Docker');
  }

  // Monorepo detection
  const monorepo = exists('pnpm-workspace.yaml') || exists('lerna.json') || (pkg?.workspaces);
  
  const lines = [
    `Project: ${info.name}`,
    `Language: ${info.language.join(', ') || 'Unknown'}`,
    `Framework: ${info.framework.join(', ') || 'None detected'}`,
    `Package Manager: ${info.packageManager ?? 'Unknown'}`,
    `Build Tool: ${info.buildTool ?? 'Unknown'}`,
    `Test Framework: ${info.testFramework ?? 'Unknown'}`,
    `Entry Point: ${info.entryPoint ?? 'Unknown'}`,
    `Monorepo: ${monorepo ? 'Yes' : 'No'}`,
  ];

  return { success: true, output: lines.join('\n'), metadata: info as unknown as Record<string, unknown> };
}
