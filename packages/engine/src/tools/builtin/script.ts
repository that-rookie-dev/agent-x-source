import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { getScriptRPC, type ScriptLanguage } from '../ScriptRPCExecutor.js';
import { getPythonRPC } from '../PythonRPCExecutor.js';

const VALID_LANGS = new Set(['auto', 'javascript', 'typescript', 'python', 'bash', 'node', 'js', 'ts', 'sh']);

function normalizeLanguage(raw: string | undefined): ScriptLanguage {
  const lang = (raw ?? 'auto').toLowerCase();
  if (lang === 'node' || lang === 'js') return 'javascript';
  if (lang === 'ts') return 'typescript';
  if (lang === 'sh') return 'bash';
  if (VALID_LANGS.has(lang)) return lang as ScriptLanguage;
  return 'auto';
}

function formatResult(result: { success: boolean; stdout: string; stderr: string; exitCode: number; elapsed: number; runtime?: string }): ToolResult {
  if (result.success) {
    return {
      success: true,
      output: result.stdout || '(no output)',
      metadata: { elapsed: result.elapsed, runtime: result.runtime },
    };
  }
  const errOut = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
  return {
    success: false,
    output: errOut || 'Script execution failed',
    error: `EXIT_${result.exitCode}`,
    metadata: { elapsed: result.elapsed, runtime: result.runtime },
  };
}

/** Unified script runner — prefer over python_rpc for JS/TS projects. */
export async function scriptRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const script = args['script'] as string;
  if (!script) return { success: false, output: 'script is required', error: 'INVALID_ARGS' };

  const language = normalizeLanguage(args['language'] as string | undefined);
  const rpcArgs = (args['args'] as Record<string, unknown>) ?? {};
  const timeout = (args['timeout'] as number) || 60_000;
  const mode = (args['mode'] as string) ?? 'file';
  const executor = getScriptRPC();

  const result = mode === 'eval' && script.length < 2000
    ? executor.evalSnippet(script, language, rpcArgs, { timeout, scopePath: context.scopePath })
    : executor.executeScript(script, language, rpcArgs, { timeout, scopePath: context.scopePath });

  return formatResult(result);
}

/** Node/JavaScript/TypeScript shortcut — same as script_run with language=javascript|typescript. */
export async function nodeRpc(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const script = args['script'] as string;
  if (!script) return { success: false, output: 'script is required', error: 'INVALID_ARGS' };

  const langArg = args['language'] as string | undefined;
  const language = langArg === 'typescript' || langArg === 'ts' ? 'typescript' : 'javascript';
  const rpcArgs = (args['args'] as Record<string, unknown>) ?? {};
  const timeout = (args['timeout'] as number) || 60_000;
  const executor = getScriptRPC();
  const result = executor.executeScript(script, language, rpcArgs, { timeout, scopePath: context.scopePath });
  return formatResult(result);
}

/** Legacy Python RPC — delegates to embedded Python executor when language is python-only. */
export async function pythonRpc(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const script = args['script'] as string;
  if (!script) return { success: false, output: 'script is required', error: 'INVALID_ARGS' };

  const rpcArgs = (args['args'] as Record<string, unknown>) ?? {};
  const timeout = (args['timeout'] as number) || 60_000;
  const executor = getPythonRPC();
  const result = executor.executeScript(script, rpcArgs, { timeout });
  return formatResult({ ...result, runtime: 'python' });
}
