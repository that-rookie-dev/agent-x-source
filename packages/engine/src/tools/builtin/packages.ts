import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function packageInstall(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const packages = args['packages'] as string[] | string;
  const dev = args['dev'] as boolean;
  const cwd = resolve(context.scopePath);

  const pm = detectPackageManager(cwd);
  const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;

  let cmd: string;
  switch (pm) {
    case 'pnpm':
      cmd = `pnpm add ${dev ? '-D ' : ''}${pkgList}`;
      break;
    case 'yarn':
      cmd = `yarn add ${dev ? '--dev ' : ''}${pkgList}`;
      break;
    default:
      cmd = `npm install ${dev ? '--save-dev ' : ''}${pkgList}`;
  }

  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120000 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    return { success: false, output: err.stderr ?? err.message, error: 'INSTALL_ERROR' };
  }
}

export async function packageRemove(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const packages = args['packages'] as string[] | string;
  const cwd = resolve(context.scopePath);
  const pm = detectPackageManager(cwd);
  const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;

  let cmd: string;
  switch (pm) {
    case 'pnpm': cmd = `pnpm remove ${pkgList}`; break;
    case 'yarn': cmd = `yarn remove ${pkgList}`; break;
    default: cmd = `npm uninstall ${pkgList}`;
  }

  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'REMOVE_ERROR' };
  }
}

export async function packageList(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const pkgPath = join(cwd, 'package.json');

  if (!existsSync(pkgPath)) {
    return { success: false, output: 'No package.json found', error: 'NOT_FOUND' };
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const deps = Object.entries(pkg.dependencies ?? {}).map(([k, v]) => `  ${k}: ${v}`);
    const devDeps = Object.entries(pkg.devDependencies ?? {}).map(([k, v]) => `  ${k}: ${v}`);

    let output = '';
    if (deps.length > 0) output += `Dependencies:\n${deps.join('\n')}\n`;
    if (devDeps.length > 0) output += `Dev Dependencies:\n${devDeps.join('\n')}`;

    return { success: true, output: output.trim() || 'No dependencies' };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'PARSE_ERROR' };
  }
}

export async function packageOutdated(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const pm = detectPackageManager(cwd);

  try {
    const cmd = pm === 'pnpm' ? 'pnpm outdated' : pm === 'yarn' ? 'yarn outdated' : 'npm outdated';
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 });
    return { success: true, output: output.trim() || 'All packages up to date' };
  } catch (error) {
    // npm outdated returns non-zero when packages are outdated
    const err = error as { stdout?: string; message: string };
    return { success: true, output: err.stdout?.trim() ?? 'All packages up to date' };
  }
}

export async function packageRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const script = args['script'] as string;
  const cwd = resolve(context.scopePath);
  const pm = detectPackageManager(cwd);

  try {
    const cmd = pm === 'pnpm' ? `pnpm run ${script}` : pm === 'yarn' ? `yarn ${script}` : `npm run ${script}`;
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'SCRIPT_ERROR' };
  }
}

function detectPackageManager(cwd: string): 'npm' | 'pnpm' | 'yarn' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml')) || existsSync(join(cwd, 'pnpm-workspace.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}
