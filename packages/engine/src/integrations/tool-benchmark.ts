import type {
  IntegrationBenchmarkSummary,
  IntegrationProvider,
  IntegrationToolBenchmark,
} from '@agentx/shared';
import { isReadOnlyIntegrationTool } from './action-classifier.js';
import { cleanMcpErrorMessage } from './clean-mcp-error.js';
import { isMcpToolResultError } from './mcp/mcp-result.js';
import type { McpSession } from './mcp/client.js';

const MAX_READ_PROBES = 12;
const PER_TOOL_TIMEOUT_MS = 8_000;

function schemaRequiresArgs(schema?: Record<string, unknown>): boolean {
  const required = schema?.required;
  return Array.isArray(required) && required.length > 0;
}

function formatToolOutput(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const payload = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
    if (Array.isArray(payload.content)) {
      return payload.content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n');
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms (${label})`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function summarizeBenchmarks(benchmarks: IntegrationToolBenchmark[]): IntegrationBenchmarkSummary {
  let ok = 0;
  let error = 0;
  let skipped = 0;
  for (const item of benchmarks) {
    if (item.status === 'ok') ok += 1;
    else if (item.status === 'error') error += 1;
    else skipped += 1;
  }
  return { ok, error, skipped };
}

/**
 * Probe every read-only MCP tool with empty args (when safe).
 * Write/update tools are skipped — failures there are recorded at runtime.
 */
export async function benchmarkReadTools(options: {
  session: McpSession;
  provider: IntegrationProvider;
  toolNames: string[];
  bridgeNames?: Set<string>;
}): Promise<IntegrationToolBenchmark[]> {
  const { session, provider, toolNames, bridgeNames } = options;
  const listed = await session.listTools();
  const schemaByName = new Map(listed.map((t) => [t.name, t.inputSchema]));
  const now = new Date().toISOString();
  const results: IntegrationToolBenchmark[] = [];
  let probed = 0;

  for (const mcpName of toolNames) {
    const readonly = isReadOnlyIntegrationTool(mcpName, provider);
    if (!readonly) {
      results.push({
        mcpName,
        readonly: false,
        status: 'skipped',
        skipReason: 'Write/update tools are checked when they are used',
        testedAt: now,
      });
      continue;
    }
    if (bridgeNames?.has(mcpName)) {
      results.push({
        mcpName,
        readonly: true,
        status: 'skipped',
        skipReason: 'Bridge tool — not probed automatically',
        testedAt: now,
      });
      continue;
    }
    if (probed >= MAX_READ_PROBES) {
      results.push({
        mcpName,
        readonly: true,
        status: 'skipped',
        skipReason: `Probe limit (${MAX_READ_PROBES}) reached`,
        testedAt: now,
      });
      continue;
    }

    const schema = schemaByName.get(mcpName);
    if (schemaRequiresArgs(schema)) {
      results.push({
        mcpName,
        readonly: true,
        status: 'skipped',
        skipReason: 'Requires parameters — probe skipped',
        testedAt: now,
      });
      continue;
    }

    probed += 1;
    try {
      const raw = await withTimeout(session.callTool(mcpName, {}), PER_TOOL_TIMEOUT_MS, mcpName);
      const output = formatToolOutput(raw);
      const failed = isMcpToolResultError(raw, output);
      if (failed) {
        results.push({
          mcpName,
          readonly: true,
          status: 'error',
          error: cleanMcpErrorMessage(output || 'Tool returned an error'),
          testedAt: now,
        });
      } else {
        results.push({
          mcpName,
          readonly: true,
          status: 'ok',
          testedAt: now,
        });
      }
    } catch (error) {
      results.push({
        mcpName,
        readonly: true,
        status: 'error',
        error: cleanMcpErrorMessage(error instanceof Error ? error.message : String(error)),
        testedAt: now,
      });
    }
  }

  return results;
}
