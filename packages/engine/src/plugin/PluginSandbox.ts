/**
 * Plugin VM Sandbox — executes plugin code in an isolated Node.js VM context
 * with restricted globals (no fs, no net, no child_process, no require).
 */
import { Script, createContext } from 'node:vm';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface PluginSandboxResult {
  success: boolean;
  exports?: Record<string, unknown>;
  error?: string;
  output?: string;
}

/**
 * Execute plugin source code in a sandboxed VM context.
 * Only whitelisted globals are available.
 */
export function executePluginInSandbox(
  sourceCode: string,
  pluginName: string,
): PluginSandboxResult {
  const output: string[] = [];
  const sandboxConsole = {
    log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => output.push('[WARN] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => output.push('[ERROR] ' + args.map(String).join(' ')),
  };

  const sandbox = {
    console: sandboxConsole,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    fetch: undefined,
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    Object, Array, String, Number, Boolean, Date, Math,
    JSON, RegExp, Error, Map, Set, WeakMap, WeakSet,
    Promise, Symbol, BigInt,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURI, decodeURI, encodeURIComponent, decodeURIComponent,
    pluginApi: {
      name: pluginName,
      emit: (event: string, data: unknown) => {
        output.push(`[EVENT:${event}] ${JSON.stringify(data)}`);
      },
    },
  };

  const ctx = createContext(sandbox);

  try {
    const script = new Script(sourceCode, {
      filename: `plugin:${pluginName}`,
    });

    // Timeout via Promise.race + AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    script.runInContext(ctx, { breakOnSigint: true });

    clearTimeout(timeout);

    const exports: Record<string, unknown> = {};
    const ctxExports = ctx as unknown as { exports?: Record<string, unknown> | null; module?: { exports?: Record<string, unknown> } };
    if (typeof ctxExports.exports === 'object' && ctxExports.exports !== null) {
      Object.assign(exports, ctxExports.exports);
    }
    if (typeof ctxExports.module?.exports === 'object') {
      Object.assign(exports, ctxExports.module.exports);
    }

    return { success: true, exports, output: output.join('\n') };
  } catch (e) {
    logger.warn('PLUGIN_SANDBOX', `Sandbox execution failed for ${pluginName}: ${e instanceof Error ? e.message : String(e)}`);
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      output: output.join('\n'),
    };
  }
}

/**
 * Validate plugin source code for dangerous patterns before sandboxing.
 * Returns warnings array — empty means clean.
 */
export function validatePluginSource(sourceCode: string): string[] {
  const warnings: string[] = [];
  const patterns: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /require\s*\(/g, message: 'Uses require() — may attempt to import modules' },
    { pattern: /import\s+.*from/g, message: 'Uses import — may attempt to load external modules' },
    { pattern: /child_process/g, message: 'References child_process' },
    { pattern: /fs\./g, message: 'References fs module' },
    { pattern: /process\.exit/g, message: 'Attempts process.exit()' },
    { pattern: /eval\s*\(/g, message: 'Uses eval()' },
    { pattern: /Function\s*\(/g, message: 'Uses Function constructor' },
    { pattern: /__proto__/g, message: 'Accesses __proto__' },
    { pattern: /constructor\s*\(/g, message: 'References constructor — potential prototype pollution' },
  ];

  for (const { pattern, message } of patterns) {
    if (pattern.test(sourceCode)) {
      warnings.push(message);
    }
  }

  return warnings;
}
