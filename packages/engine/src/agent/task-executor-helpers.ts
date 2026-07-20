import type { Agent } from './Agent.js';

export const ANALYSIS_SYSTEM_PROMPT = `You are an environment analysis expert. Given a user's goal and the current working directory context, analyze what's available and what needs to be done.

The user may be a developer, designer, finance professional, artist, or any other knowledge worker.

Return a JSON object:
{
  "projectType": "new" | "existing" | "non_code",
  "keyFiles": ["list", "of", "relevant", "files", "documents"],
  "techStack": ["tools", "technologies", "runtimes", "or", "software", "detected"],
  "conventions": ["relevant", "patterns", "rules", "or", "constraints"],
  "risks": ["potential", "issues", "or", "missing", "tools"],
  "domain": "code" | "design" | "finance" | "data" | "writing" | "general"
}`;

export const PLAN_SYSTEM_PROMPT = `You are a task decomposition expert. Your job is to break down a user's goal into a step-by-step plan.

Given a goal, produce a JSON array of steps. Each step must have:
- "description": a clear, actionable instruction for what to do in this step
- "expectedOutcome": what success looks like for this step

Optional fields:
- "parallel": true — set this for steps that can run concurrently with other parallel steps (e.g., creating independent files)
- "dependencies": ["stepId"] — list of step IDs (by array index, 0-based) that must complete first
- "repoPath": "path/to/repo" — if work spans multiple repositories, specify which repo this step targets

Rules:
- Break the work into 3-10 steps
- Each step should be completable in a single LLM turn
- Sequential by default; use "parallel": true for independent work
- Be specific — avoid vague steps like "research" without direction
- If the goal requires external information (API docs, package docs, best practices, etc.), include a "research" step that uses web search to gather information before proceeding
- The last step should produce the final deliverable
- COST AWARENESS: Simple verification, linting, and review steps can use cheaper/faster models. Complex coding steps need full capability. Never waste budget on trivial steps.
- Cross-repo: If the goal spans multiple repos, add "repoPath" to each step to indicate which repo it operates in

Web research is available and the agent can search the web for information, documentation, and examples during execution.

Return ONLY a valid JSON array. No markdown, no explanation.`;

export const VERIFY_SYSTEM_PROMPT = `You are a quality assurance expert. Given a task step and its result, determine if the step was completed successfully.

Respond with ONLY a JSON object:
{ "passed": boolean, "reason": "short explanation" }

Be strict — if the expected outcome is not fully met, mark as failed.`;

export const DEBUG_SYSTEM_PROMPT = `You are a debugging expert. A step was completed but the build/test failed. Given the error output, fix the issue.

Return a JSON object:
{ "fix": "what to fix and how", "revisedStep": "revised step description if needed" }

Be specific about what code changes are needed.`;

export const FINAL_VERIFY_SYSTEM_PROMPT = `You are a quality assurance expert. Given a user's original goal and the completed steps of a plan, determine if the goal has been fully achieved.

Respond with ONLY a JSON object:
{ "achieved": boolean, "reason": "short explanation", "gaps": ["any missing aspects"] }

Be strict — if the goal is not fully met, note what's missing.`;

export function extractJsonArray(text: string): Array<Record<string, unknown>> | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractJsonObject<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export function tryShellExec(agent: Agent, command: string): Promise<string> {
  const executor = agent.getToolExecutor();
  if (!executor?.execute) return Promise.resolve('');
  return executor.execute('shell_exec', { command }, agent.sessionId ?? 'unknown')
    .then((r) => r.output ?? '')
    .catch(() => '');
}
