import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

type Ecosystem = 'node' | 'python' | 'rust' | 'go';
type NodePM = 'npm' | 'pnpm' | 'yarn';
type PythonPM = 'pip' | 'poetry' | 'uv';
type RustPM = 'cargo';
type GoPM = 'go';

interface PM {
  ecosystem: Ecosystem;
  node?: NodePM;
  python?: PythonPM;
  rust?: RustPM;
  go?: GoPM;
}

function detectPM(cwd: string): PM {
  if (existsSync(join(cwd, 'pnpm-lock.yaml')) || existsSync(join(cwd, 'pnpm-workspace.yaml')))
    return { ecosystem: 'node', node: 'pnpm' };
  if (existsSync(join(cwd, 'yarn.lock')))
    return { ecosystem: 'node', node: 'yarn' };
  if (existsSync(join(cwd, 'package.json')))
    return { ecosystem: 'node', node: 'npm' };
  if (existsSync(join(cwd, 'pyproject.toml'))) {
    try {
      const content = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
      if (content.includes('[tool.poetry]') || content.includes('[build-system]') && existsSync(join(cwd, 'poetry.lock')))
        return { ecosystem: 'python', python: 'poetry' };
      if (content.includes('[tool.uv]'))
        return { ecosystem: 'python', python: 'uv' };
    } catch { /* fallthrough */ }
  }
  if (existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'setup.cfg')))
    return { ecosystem: 'python', python: 'pip' };
  if (existsSync(join(cwd, 'requirements.txt')) && !existsSync(join(cwd, 'pyproject.toml')))
    return { ecosystem: 'python', python: 'pip' };
  if (existsSync(join(cwd, 'Cargo.toml')))
    return { ecosystem: 'rust', rust: 'cargo' };
  if (existsSync(join(cwd, 'go.mod')))
    return { ecosystem: 'go', go: 'go' };
  return { ecosystem: 'node', node: 'npm' };
}

function execCmd(cmd: string, cwd: string, timeout = 120000): ToolResult {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    return { success: false, output: [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message, error: 'EXEC_ERROR' };
  }
}

export async function packageInstall(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const packages = args['packages'] as string[] | string;
  const dev = args['dev'] as boolean;
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);
  const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;

  switch (pm.ecosystem) {
    case 'node': {
      const p = pm.node!;
      if (p === 'pnpm') return execCmd(`pnpm add ${dev ? '-D ' : ''}${pkgList}`, cwd);
      if (p === 'yarn') return execCmd(`yarn add ${dev ? '--dev ' : ''}${pkgList}`, cwd);
      return execCmd(`npm install ${dev ? '--save-dev ' : ''}${pkgList}`, cwd);
    }
    case 'python': {
      const p = pm.python!;
      if (p === 'poetry') return execCmd(`poetry add ${dev ? '--group dev ' : ''}${pkgList}`, cwd);
      if (p === 'uv') return execCmd(`uv add ${dev ? '--dev ' : ''}${pkgList}`, cwd);
      return execCmd(`pip install ${pkgList}`, cwd);
    }
    case 'rust': return execCmd(`cargo add ${pkgList}${dev ? ' --dev' : ''}`, cwd);
    case 'go': return execCmd(`go get ${pkgList}`, cwd);
    default: return { success: false, output: 'Unsupported ecosystem', error: 'UNSUPPORTED' };
  }
}

export async function packageRemove(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const packages = args['packages'] as string[] | string;
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);
  const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;

  switch (pm.ecosystem) {
    case 'node': {
      const p = pm.node!;
      if (p === 'pnpm') return execCmd(`pnpm remove ${pkgList}`, cwd, 60000);
      if (p === 'yarn') return execCmd(`yarn remove ${pkgList}`, cwd, 60000);
      return execCmd(`npm uninstall ${pkgList}`, cwd, 60000);
    }
    case 'python': {
      const p = pm.python!;
      if (p === 'poetry') return execCmd(`poetry remove ${pkgList}`, cwd, 60000);
      if (p === 'uv') return execCmd(`uv remove ${pkgList}`, cwd, 60000);
      return execCmd(`pip uninstall -y ${pkgList}`, cwd, 60000);
    }
    case 'rust': return execCmd(`cargo remove ${pkgList}`, cwd, 60000);
    case 'go': return execCmd(`go get ${pkgList}@none`, cwd, 60000);
    default: return { success: false, output: 'Unsupported ecosystem', error: 'UNSUPPORTED' };
  }
}

export async function packageList(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);

  switch (pm.ecosystem) {
    case 'node': {
      const pkgPath = join(cwd, 'package.json');
      if (!existsSync(pkgPath)) return { success: false, output: 'No package.json found', error: 'NOT_FOUND' };
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const deps = Object.entries(pkg.dependencies ?? {}).map(([k, v]) => `  ${k}: ${v}`);
        const devDeps = Object.entries(pkg.devDependencies ?? {}).map(([k, v]) => `  ${k}: ${v}`);
        let output = '';
        if (deps.length > 0) output += `Dependencies:\n${deps.join('\n')}\n`;
        if (devDeps.length > 0) output += `Dev Dependencies:\n${devDeps.join('\n')}`;
        return { success: true, output: output.trim() || 'No dependencies' };
      } catch (e) {
        return { success: false, output: (e as Error).message, error: 'PARSE_ERROR' };
      }
    }
    case 'python': {
      const p = pm.python!;
      if (p === 'poetry') return execCmd('poetry show --tree', cwd);
      if (p === 'uv') return execCmd('uv pip list', cwd);
      return execCmd('pip list', cwd);
    }
    case 'rust': return execCmd('cargo tree --depth 1', cwd);
    case 'go': return execCmd('go list -m all', cwd);
    default: return { success: true, output: '' };
  }
}

export async function packageOutdated(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);

  switch (pm.ecosystem) {
    case 'node': {
      const p = pm.node!;
      try {
        const cmd = p === 'pnpm' ? 'pnpm outdated' : p === 'yarn' ? 'yarn outdated' : 'npm outdated';
        execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 });
        return { success: true, output: 'All packages up to date' };
      } catch (error) {
        const err = error as { stdout?: string; message: string };
        return { success: true, output: err.stdout?.trim() ?? 'All packages up to date' };
      }
    }
    case 'python': {
      const p = pm.python!;
      return execCmd(p === 'pip' ? 'pip list --outdated' : `${p} show --outdated`, cwd, 30000);
    }
    case 'rust': return execCmd('cargo update --dry-run', cwd, 30000);
    case 'go': return execCmd('go list -u -m all', cwd, 30000);
    default: return { success: true, output: '' };
  }
}

export async function packageRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const script = args['script'] as string;
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);

  switch (pm.ecosystem) {
    case 'node': {
      const p = pm.node!;
      const cmd = p === 'pnpm' ? `pnpm run ${script}` : p === 'yarn' ? `yarn ${script}` : `npm run ${script}`;
      return execCmd(cmd, cwd);
    }
    case 'python': {
      const p = pm.python!;
      if (p === 'poetry') return execCmd(`poetry run ${script}`, cwd);
      if (p === 'uv') return execCmd(`uv run ${script}`, cwd);
      return execCmd(`${script}`, cwd);
    }
    case 'rust': return execCmd(`cargo run ${script}`, cwd);
    case 'go': return execCmd(`go run ${script}`, cwd);
    default: return { success: false, output: 'Unsupported ecosystem', error: 'UNSUPPORTED' };
  }
}

export async function pkgUpdate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const packages = args['packages'] as string | undefined;
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);

  switch (pm.ecosystem) {
    case 'node': {
      const p = pm.node!;
      if (packages) {
        if (p === 'pnpm') return execCmd(`pnpm update ${packages}`, cwd);
        if (p === 'yarn') return execCmd(`yarn upgrade ${packages}`, cwd);
        return execCmd(`npm update ${packages}`, cwd);
      }
      if (p === 'pnpm') return execCmd('pnpm update', cwd);
      if (p === 'yarn') return execCmd('yarn upgrade', cwd);
      return execCmd('npm update', cwd);
    }
    case 'python': {
      const p = pm.python!;
      if (p === 'poetry') return execCmd(packages ? `poetry update ${packages}` : 'poetry update', cwd);
      if (p === 'uv') return execCmd('uv pip install --upgrade ' + (packages ?? '--all'), cwd);
      return execCmd(packages ? `pip install --upgrade ${packages}` : 'pip list --outdated', cwd);
    }
    case 'rust': return execCmd('cargo update', cwd);
    case 'go': return execCmd(`go get -u ${packages ?? './...'}`, cwd);
    default: return { success: false, output: 'Unsupported ecosystem', error: 'UNSUPPORTED' };
  }
}

export async function pkgAudit(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const pm = detectPM(cwd);

  switch (pm.ecosystem) {
    case 'node': {
      const p = pm.node!;
      try {
        const cmd = p === 'pnpm' ? 'pnpm audit --json' : 'npm audit --json';
        const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60000 });
        try {
          const report = JSON.parse(output) as { vulnerabilities?: Record<string, number>; metadata?: { vulnerabilities?: Record<string, number> } };
          const vulns = report.vulnerabilities ?? report.metadata?.vulnerabilities;
          if (!vulns) return { success: true, output: 'No vulnerabilities found' };
          const summary = Object.entries(vulns).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ');
          return { success: true, output: summary || 'No vulnerabilities found' };
        } catch { return { success: true, output: output.trim() || 'No vulnerabilities found' }; }
      } catch { return { success: true, output: 'No vulnerabilities found or audit failed' }; }
    }
    case 'rust': return execCmd('cargo audit', cwd, 60000);
    case 'go': return execCmd('govulncheck ./...', cwd, 60000);
    default: return { success: true, output: 'Audit not available for this ecosystem' };
  }
}

export async function pkgSearch(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const query = args['query'] as string;
  const limit = (args['limit'] as number) ?? 10;

  try {
    const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const data = (await response.json()) as { objects?: Array<{ package: { name: string; description: string; version: string; publisher?: { username: string } } }> };
    if (!data.objects?.length) return { success: true, output: 'No packages found' };
    const results = data.objects.map((o) => `${o.package.name}@${o.package.version}\n  ${o.package.description ?? '(no description)'}`);
    return { success: true, output: results.join('\n\n'), metadata: { count: results.length } };
  } catch (error) {
    return { success: false, output: `Search failed: ${(error as Error).message}`, error: 'SEARCH_ERROR' };
  }
}
