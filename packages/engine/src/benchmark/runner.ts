import { randomUUID } from 'node:crypto';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { collectCompletion } from './completion.js';
import { computeGrade } from './grading.js';
import { runModalityProbes } from './modality-probes.js';
import { formatBenchmarkAbortError, isProviderAccessOrNetworkError } from './probe-errors.js';
import { explainFailure, explainPass, formatTestDetails } from './test-explanations.js';
import type {
  BenchmarkProgressEvent,
  BenchmarkRunConfig,
  BenchmarkRunResult,
  BenchmarkTestId,
  BenchmarkTestResult,
} from './types.js';
import type { CompletionRequest } from '@agentx/shared';

type TestDef = {
  id: BenchmarkTestId;
  label: string;
  critical: boolean;
  maxScore: number;
  run: (provider: ProviderInterface, config: BenchmarkRunConfig) => Promise<Omit<BenchmarkTestResult, 'id' | 'label' | 'category' | 'critical' | 'maxScore'>>;
};

const BENCHMARK_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['city'],
      },
    },
  },
];

function benchmarkRequest(config: BenchmarkRunConfig, request: CompletionRequest): CompletionRequest {
  if (config.providerId !== 'google') return request;
  return { ...request, reasoningEffort: request.reasoningEffort ?? 'none' };
}

async function benchComplete(
  provider: ProviderInterface,
  config: BenchmarkRunConfig,
  request: CompletionRequest,
) {
  return collectCompletion(provider, benchmarkRequest(config, request));
}

const TESTS: TestDef[] = [
  {
    id: 'reasoning',
    label: 'Logical reasoning',
    critical: true,
    maxScore: 10,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content:
              'A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost in dollars? Reply with ONLY the numeric answer (e.g. 0.05).',
          },
        ],
        temperature: 0,
        maxTokens: 32,
      });
      const num = parseFloat(text.replace(/[^0-9.]/g, ''));
      const passed = Math.abs(num - 0.05) < 0.001;
      return {
        score: passed ? 10 : 0,
        passed,
        latencyMs,
        details: passed
          ? explainPass('Correctly solved the bat-and-ball puzzle — the ball costs $0.05.')
          : explainFailure({
              task: 'solve a classic bat-and-ball arithmetic puzzle and reply with only the numeric answer in dollars',
              expected: '0.05',
              actual: `replied "${text.slice(0, 100).replace(/\n/g, ' ') || '(empty)'}"`,
            }),
      };
    },
  },
  {
    id: 'coding',
    label: 'Code generation',
    critical: true,
    maxScore: 10,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content:
              'Write a TypeScript function `isPalindrome(s: string): boolean` that ignores case and non-alphanumeric chars. Output ONLY the function, no markdown fences.',
          },
        ],
        temperature: 0.2,
        maxTokens: 256,
      });
      const hasFn = /function\s+isPalindrome|const\s+isPalindrome\s*=/.test(text);
      const hasReturn = /return\s+/.test(text);
      const passed = hasFn && hasReturn && text.length > 40;
      const score = passed ? 10 : hasFn ? 5 : 0;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 10, passed,
          'Produced a complete TypeScript isPalindrome function with a return statement.',
          {
            task: 'write a TypeScript function `isPalindrome(s: string): boolean` that ignores case and non-alphanumeric characters, outputting only the function with no markdown',
            expected: 'a valid function declaration or const assignment with logic and a return statement',
            actual: hasFn
              ? `returned a partial function body that was too short or incomplete: "${text.slice(0, 100).replace(/\n/g, ' ')}"`
              : `did not produce a function at all: "${text.slice(0, 100).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          hasFn
            ? {
                actual: `declared isPalindrome but the body was incomplete or too short: "${text.slice(0, 100).replace(/\n/g, ' ')}"`,
                gap: 'A usable palindrome check needs a full implementation, not just a stub.',
              }
            : undefined,
        ),
      };
    },
  },
  {
    id: 'debugging',
    label: 'Debug & fix',
    critical: true,
    maxScore: 10,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content: `Fix this bug and reply with ONLY the corrected line:\n\ndef sum(nums):\n    total = 0\n    for i in range(len(nums) + 1):\n        total += nums[i]\n    return total`,
          },
        ],
        temperature: 0,
        maxTokens: 64,
      });
      const passed = /range\s*\(\s*len\s*\(\s*nums\s*\)\s*\)/.test(text) && !/len\s*\(\s*nums\s*\)\s*\+\s*1/.test(text);
      const score = passed ? 10 : /range/.test(text) ? 5 : 0;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 10, passed,
          'Fixed the off-by-one loop bound in the Python sum function.',
          {
            task: 'fix an off-by-one bug in a Python sum loop and reply with only the corrected for-loop line',
            expected: 'for i in range(len(nums)):',
            actual: `replied "${text.slice(0, 100).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          /range/.test(text)
            ? {
                actual: `mentioned range() but still used the wrong upper bound: "${text.slice(0, 100).replace(/\n/g, ' ')}"`,
                gap: 'The loop must stop at len(nums), not len(nums) + 1, to avoid an IndexError.',
              }
            : undefined,
        ),
      };
    },
  },
  {
    id: 'documentation',
    label: 'Document creation',
    critical: false,
    maxScore: 8,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content:
              'Write a 3-bullet README section for an API endpoint POST /agents/run. Include Purpose, Request body, Response. Max 80 words.',
          },
        ],
        temperature: 0.3,
        maxTokens: 200,
      });
      const bullets = (text.match(/^[\s]*[-*•]/gm) ?? []).length;
      const mentions = ['purpose', 'request', 'response', 'body', 'post'].filter((w) =>
        text.toLowerCase().includes(w),
      ).length;
      const passed = bullets >= 2 && mentions >= 2 && text.length > 60;
      const score = passed ? 8 : text.length > 40 ? 4 : 0;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 8, passed,
          'Wrote a structured README section covering Purpose, Request body, and Response.',
          {
            task: 'write a 3-bullet README section for POST /agents/run covering Purpose, Request body, and Response in under 80 words',
            expected: 'at least two bullet points mentioning purpose, request, and response topics',
            actual: `returned ${bullets} bullet(s) with ${mentions}/5 expected keywords in: "${text.slice(0, 120).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          text.length > 40
            ? {
                actual: `wrote some content (${bullets} bullets, ${mentions}/5 keywords) but missed the required structure: "${text.slice(0, 120).replace(/\n/g, ' ')}"`,
                gap: 'The section needs clearer Purpose, Request body, and Response bullets.',
              }
            : undefined,
        ),
      };
    },
  },
  {
    id: 'clarification',
    label: 'Clarification instinct',
    critical: false,
    maxScore: 8,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content: 'Deploy the agent to production.',
          },
        ],
        temperature: 0.3,
        maxTokens: 180,
      });
      const lower = text.toLowerCase();
      const asks = ['which', 'what', 'clarif', 'environment', 'confirm', 'need more', '?', 'specify', 'details'].some(
        (k) => lower.includes(k),
      );
      const reckless = ['deployed', 'done', 'completed', 'successfully deployed'].some((k) => lower.includes(k));
      const passed = asks && !reckless;
      const score = passed ? 8 : asks ? 5 : 0;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 8, passed,
          'Asked clarifying questions before pretending to deploy, instead of acting recklessly.',
          {
            task: 'respond to the vague instruction "Deploy the agent to production" as an autonomous agent',
            expected: 'clarifying questions about environment, target, or confirmation before acting',
            actual: reckless
              ? `claimed deployment succeeded without asking anything: "${text.slice(0, 120).replace(/\n/g, ' ')}"`
              : `did not ask clarifying questions: "${text.slice(0, 120).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          asks
            ? {
                actual: `asked some questions but the response was still ambiguous: "${text.slice(0, 120).replace(/\n/g, ' ')}"`,
                gap: 'A safe agent should ask specific questions and avoid implying the deployment already happened.',
              }
            : undefined,
        ),
      };
    },
  },
  {
    id: 'decision_making',
    label: 'Decision making',
    critical: false,
    maxScore: 8,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content:
              'Choose the best datastore for a chat app with 10M users, heavy reads, occasional writes, need full-text search. Pick ONE: PostgreSQL, Redis, MongoDB, Elasticsearch. Reply JSON: {"choice":"...","reason":"one sentence"}',
          },
        ],
        temperature: 0.2,
        maxTokens: 120,
      });
      let choice = '';
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) choice = (JSON.parse(m[0]) as { choice?: string }).choice?.toLowerCase() ?? '';
      } catch { /* ignore */ }
      const good = ['mongodb', 'elasticsearch', 'elastic'].some((c) => choice.includes(c));
      const passed = good && text.includes('reason');
      const score = passed ? 8 : choice ? 4 : 0;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 8, passed,
          `Chose ${choice || 'a suitable datastore'} with a one-sentence reason in JSON.`,
          {
            task: 'pick the best datastore for a chat app with heavy reads, occasional writes, and full-text search, replying as JSON {"choice":"...","reason":"..."}',
            expected: 'MongoDB or Elasticsearch with a reason field explaining the choice',
            actual: choice
              ? `returned choice "${choice}" ${text.includes('reason') ? 'with' : 'without'} a reason field`
              : `did not return valid JSON: "${text.slice(0, 120).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          choice
            ? {
                actual: `chose "${choice}" but the JSON was incomplete or suboptimal for read-heavy search: "${text.slice(0, 120).replace(/\n/g, ' ')}"`,
                gap: 'For 10M users with heavy reads and search, MongoDB or Elasticsearch is a stronger fit than a pure OLTP or cache store.',
              }
            : undefined,
        ),
      };
    },
  },
  {
    id: 'tool_calling',
    label: 'Tool / function calling',
    critical: true,
    maxScore: 12,
    run: async (provider, config) => {
      const { text, toolCalls, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content: 'What is the weather in Tokyo in celsius? Use the get_weather tool.',
          },
        ],
        tools: BENCHMARK_TOOLS,
        temperature: 0,
        maxTokens: 128,
      });
      const tc = toolCalls[0];
      const nameOk = tc?.function?.name === 'get_weather';
      let argsOk = false;
      try {
        const args = JSON.parse(tc?.function?.arguments ?? '{}') as { city?: string };
        argsOk = /tokyo/i.test(args.city ?? '');
      } catch { /* ignore */ }
      const passed = nameOk && argsOk;
      const score = passed ? 12 : nameOk ? 6 : toolCalls.length > 0 ? 3 : 0;
      let partialReason: { actual: string; gap: string } | undefined;
      if (nameOk && !argsOk) {
        partialReason = {
          actual: `called get_weather but with the wrong city argument: ${tc?.function?.arguments?.slice(0, 80) ?? '(empty args)'}`,
          gap: 'The tool call must pass city: "Tokyo" to answer the weather question correctly.',
        };
      } else if (toolCalls.length > 0) {
        partialReason = {
          actual: `invoked tool "${tc?.function?.name ?? 'unknown'}" instead of the expected get_weather call`,
          gap: 'Agent-X workloads depend on selecting the right tool with the right arguments on the first try.',
        };
      }
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 12, passed,
          'Called get_weather with city set to Tokyo and units suitable for the question.',
          {
            task: 'answer "What is the weather in Tokyo in celsius?" by invoking the get_weather tool',
            expected: 'a tool call to get_weather with city: "Tokyo"',
            actual: toolCalls.length > 0
              ? `invoked ${tc?.function?.name ?? 'a tool'} with args ${tc?.function?.arguments?.slice(0, 80) ?? '(empty)'}`
              : `answered in plain text instead of using a tool: "${text.slice(0, 100).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          partialReason,
        ),
      };
    },
  },
  {
    id: 'json_structure',
    label: 'Structured JSON output',
    critical: true,
    maxScore: 10,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content:
              'Return ONLY valid JSON (no markdown): {"status":"ok","tasks":["read","write"],"priority":2}',
          },
        ],
        temperature: 0,
        maxTokens: 80,
      });
      let parsed: { status?: string; tasks?: string[]; priority?: number } | null = null;
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch { /* ignore */ }
      const passed =
        parsed?.status === 'ok' &&
        Array.isArray(parsed.tasks) &&
        parsed.tasks.length === 2 &&
        parsed.priority === 2;
      const score = passed ? 10 : parsed ? 5 : 0;
      let partialReason: { actual: string; gap: string } | undefined;
      if (parsed && !passed) {
        const issues: string[] = [];
        if (parsed.status !== 'ok') issues.push(`status="${parsed.status}"`);
        if (!Array.isArray(parsed.tasks) || parsed.tasks.length !== 2) issues.push(`tasks=${JSON.stringify(parsed.tasks)}`);
        if (parsed.priority !== 2) issues.push(`priority=${parsed.priority}`);
        partialReason = {
          actual: `returned JSON but with incorrect fields (${issues.join(', ')})`,
          gap: 'The response must exactly match {"status":"ok","tasks":["read","write"],"priority":2} with no markdown.',
        };
      }
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 10, passed,
          'Returned the exact JSON object requested with no markdown wrapping.',
          {
            task: 'return ONLY valid JSON matching {"status":"ok","tasks":["read","write"],"priority":2}',
            expected: 'raw JSON with status "ok", tasks ["read","write"], and priority 2',
            actual: parsed
              ? `returned parseable JSON that did not match the schema: ${text.slice(0, 120).replace(/\n/g, ' ')}`
              : `did not return valid JSON: "${text.slice(0, 120).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          partialReason,
        ),
      };
    },
  },
  {
    id: 'instruction_following',
    label: 'Instruction adherence',
    critical: false,
    maxScore: 8,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'user',
            content:
              'Reply with exactly 2 lines. Line 1 must be the word ALPHA in uppercase. Line 2 must be the word OMEGA in uppercase. Nothing else.',
          },
        ],
        temperature: 0,
        maxTokens: 32,
      });
      const lines = text
        .trim()
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const passed = lines.length === 2 && lines[0] === 'ALPHA' && lines[1] === 'OMEGA';
      const score = passed ? 8 : lines.some((l) => l === 'ALPHA') && lines.some((x) => x === 'OMEGA') ? 4 : 0;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 8, passed,
          'Returned exactly two lines: ALPHA on line 1 and OMEGA on line 2.',
          {
            task: 'reply with exactly 2 lines where line 1 is ALPHA and line 2 is OMEGA, with nothing else',
            expected: 'line 1 = "ALPHA", line 2 = "OMEGA", no extra text',
            actual: `returned ${lines.length} line(s): ${lines.join(' | ') || '(empty)'}`,
          },
          lines.some((l) => l === 'ALPHA') && lines.some((x) => x === 'OMEGA')
            ? {
                actual: `included both words but in the wrong format/order: ${lines.join(' | ')}`,
                gap: 'Instruction following requires exact line count and ordering, not just the presence of both words.',
              }
            : undefined,
        ),
      };
    },
  },
  {
    id: 'agent_identity',
    label: 'Agent role awareness',
    critical: false,
    maxScore: 8,
    run: async (provider, config) => {
      const { text, latencyMs } = await benchComplete(provider, config, {
        model: config.modelId,
        messages: [
          {
            role: 'system',
            content:
              'You are an autonomous coding agent. You plan, use tools, and verify work. Be concise.',
          },
          {
            role: 'user',
            content:
              'How would you approach fixing a failing CI test you have never seen before? Max 4 sentences.',
          },
        ],
        temperature: 0.3,
        maxTokens: 200,
      });
      const lower = text.toLowerCase();
      const signals = ['read', 'log', 'reproduce', 'test', 'error', 'debug', 'isolate', 'verify', 'run'].filter(
        (s) => lower.includes(s),
      );
      const passed = signals.length >= 3 && text.length > 80;
      const score = passed ? 8 : signals.length >= 2 ? 5 : 2;
      return {
        score,
        passed,
        latencyMs,
        details: formatTestDetails(
          score, 8, passed,
          `Described an agentic debugging workflow using signals like ${signals.join(', ')}.`,
          {
            task: 'explain how an autonomous coding agent would approach fixing an unfamiliar failing CI test in at most 4 sentences',
            expected: 'a concise plan mentioning reading logs, reproducing, isolating, running tests, or verifying the fix',
            actual: `mentioned only ${signals.length}/3 expected debugging signals (${signals.join(', ') || 'none'}): "${text.slice(0, 120).replace(/\n/g, ' ') || '(empty)'}"`,
          },
          signals.length >= 2
            ? {
                actual: `mentioned ${signals.join(', ')} but the answer was too brief or incomplete: "${text.slice(0, 120).replace(/\n/g, ' ')}"`,
                gap: 'A credible agent plan should cover investigation, reproduction, and verification steps.',
              }
            : undefined,
        ),
      };
    },
  },
];

export async function runModelBenchmark(
  provider: ProviderInterface,
  config: BenchmarkRunConfig,
  onProgress?: (event: BenchmarkProgressEvent) => void,
): Promise<BenchmarkRunResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const total = TESTS.length;

  onProgress?.({
    type: 'started',
    runId,
    modelId: config.modelId,
    providerId: config.providerId,
    totalTests: total,
  });

  onProgress?.({ type: 'phase', phase: 'core', message: 'Initializing capability matrix…' });

  const tests: BenchmarkTestResult[] = [];

  for (let i = 0; i < TESTS.length; i++) {
    const def = TESTS[i]!;
    onProgress?.({
      type: 'test_start',
      testId: def.id,
      label: def.label,
      index: i + 1,
      total,
    });

    try {
      const partial = await def.run(provider, config);
      const result: BenchmarkTestResult = {
        id: def.id,
        label: def.label,
        category: 'core',
        critical: def.critical,
        maxScore: def.maxScore,
        ...partial,
      };
      tests.push(result);
      onProgress?.({ type: 'test_complete', result, index: i + 1, total });
    } catch (err) {
      // Auth / network / provider-unavailable: stop the suite. Capability misses
      // and wrong answers continue so remaining probes can still score.
      if (isProviderAccessOrNetworkError(err)) {
        throw new Error(formatBenchmarkAbortError(err));
      }
      const result: BenchmarkTestResult = {
        id: def.id,
        label: def.label,
        category: 'core',
        critical: def.critical,
        maxScore: def.maxScore,
        score: 0,
        passed: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      tests.push(result);
      onProgress?.({ type: 'test_complete', result, index: i + 1, total });
    }
  }

  onProgress?.({ type: 'phase', phase: 'modality', message: 'Running live sensory channel probes…' });
  const modalities = await runModalityProbes(
    {
      providerId: config.providerId,
      modelId: config.modelId,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelCapabilities: config.modelCapabilities,
    },
    (result) => onProgress?.({ type: 'modality', result }),
  );

  onProgress?.({ type: 'phase', phase: 'grading', message: 'Computing clearance level…' });
  const { grade, overallScore, maxScore, percent } = computeGrade(tests);
  const finishedAt = new Date().toISOString();

  const result: BenchmarkRunResult = {
    runId,
    providerId: config.providerId,
    modelId: config.modelId,
    profileId: config.profileId,
    grade,
    overallScore,
    maxScore,
    percent,
    tests,
    modalities,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
  };

  onProgress?.({ type: 'complete', result });
  return result;
}

export { TESTS };
