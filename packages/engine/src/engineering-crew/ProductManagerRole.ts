import { getLogger } from '@agentx/shared';
import { CrewRole } from './CrewRole.js';
import type { EngineeringCrewMessage, PrdDocument, CrewTopic } from './types.js';
import { broadcastMessage } from './types.js';
import { extractJsonObject } from './json-extract.js';
import type { SubAgentSpawner } from './SubAgentSpawner.js';

const PM_TOOLS = ['file_read', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'web_search', 'web_fetch', 'deep_web_search', 'shell_exec', 'terminal_start', 'terminal_read', 'terminal_list'];

/**
 * Product Manager role — mirrors MetaGPT's `ProductManager`
 * (repos/metagpt/metagpt/roles/product_manager.py).
 *
 * Watches `user_requirement`, produces a Product Requirements Document (PRD) via the
 * `WritePRD` action (delegated to an LLM sub-agent), and publishes it on the `prd_ready`
 * topic for the Architect to consume.
 *
 * This is the first step in the SOP pipeline:
 *   UserRequirement → **WritePRD** → WriteDesign → WriteTasks → WriteCode → ...
 */
export class ProductManagerRole extends CrewRole {
  readonly name = 'ProductManager';
  protected readonly watchedTopics: Set<CrewTopic> = new Set(['user_requirement']);

  constructor(private readonly spawner: SubAgentSpawner) {
    super();
  }

  protected async act(messages: EngineeringCrewMessage[]): Promise<void> {
    // #4: On resume, the crew re-publishes user_requirement for context. But if a PRD
    // already exists in the environment (from a prior round or resume republish), don't
    // re-generate it — that would waste tokens and potentially change project direction.
    const existingPrd = this.environment?.messagesByTopic('prd_ready').pop();
    if (existingPrd) {
      getLogger().info('ENGINEERING_CREW', 'ProductManager skipping PRD generation — PRD already exists in environment');
      return;
    }

    const requirement = messages[messages.length - 1]!.content;
    getLogger().info('ENGINEERING_CREW', `ProductManager producing PRD for: ${requirement.slice(0, 80)}...`);

    const instruction = buildPrdInstruction(requirement);
    const result = await this.spawner.spawnAndWait(instruction, PM_TOOLS, 'product_manager', 300_000);

    const prd = parsePrd(result.output, requirement);

    if (!prd) {
      getLogger().warn('ENGINEERING_CREW', 'ProductManager failed to produce a parseable PRD; escalating.');
      this.publish(broadcastMessage(
        'unknown_escalated',
        this.name,
        'The ProductManager could not produce a structured PRD for this requirement. Manual planning is needed.',
      ));
      return;
    }

    this.publish(broadcastMessage('prd_ready', this.name, `PRD created for "${prd.productName}" with ${prd.features.length} feature(s).`, prd));
  }
}

function buildPrdInstruction(requirement: string): string {
  return `You are the Product Manager on a software engineering team. A user has requested:

"""
${requirement}
"""

BEFORE writing the PRD, you MUST research the environment and existing codebase:
1. Use shell_exec or terminal_start to check what's already installed (e.g. "java -version", "node --version", "python --version", "ls -la").
2. Use folder_tree/folder_list to inspect the existing project structure if any files exist.
3. Use file_read to read key files like package.json, pom.xml, build.gradle, requirements.txt, or any existing config.
4. Use web_search to research any external libraries or frameworks mentioned in the requirement — verify they exist, are current, and support the requested features.
5. If the requirement mentions a specific model, library, or API, use web_search to verify its capabilities and limitations.

Only after researching, produce a Product Requirements Document (PRD) as JSON (and nothing else — no prose, no markdown fences) with this exact shape:

{
  "productName": "<short product name>",
  "features": [
    { "name": "<feature name>", "description": "<what it does, with concrete acceptance criteria>", "priority": "high|medium|low" }
  ],
  "constraints": ["<technical or business constraint>", ...],
  "unknowns": ["<anything that must be verified before implementation can safely proceed>", ...]
}

Rules:
- Break the requirement into concrete, implementable features.
- Each feature must have a clear description of what it does, not how it's implemented.
- Prioritize features: "high" for must-have, "medium" for should-have, "low" for nice-to-have.
- List any technical or business constraints (e.g. "must use Java 21+", "must work offline", "API rate limit of 100/min").
- List unknowns: anything you're not 100% certain about — external API behavior, library compatibility, model requirements, environment constraints. These will be researched by the Architect and Engineer.
- Base the PRD on what you discovered in the environment, not assumptions.
- Output raw JSON only.`;
}

function parsePrd(output: string, requirement: string): PrdDocument | null {
  const json = extractJsonObject(output);
  if (!json) return null;

  const productName = typeof json['productName'] === 'string' ? json['productName'] : 'Product';
  const features = Array.isArray(json['features'])
    ? (json['features'] as unknown[])
        .map((f) => {
          const r = f as Record<string, unknown>;
          return {
            name: typeof r['name'] === 'string' ? r['name'] : 'Feature',
            description: typeof r['description'] === 'string' ? r['description'] : '',
            priority: (['high', 'medium', 'low'].includes(r['priority'] as string) ? r['priority'] : 'medium') as 'high' | 'medium' | 'low',
          };
        })
    : [];
  const constraints = Array.isArray(json['constraints'])
    ? (json['constraints'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  const unknowns = Array.isArray(json['unknowns'])
    ? (json['unknowns'] as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];

  if (features.length === 0) return null;

  return {
    originalRequirement: requirement,
    productName,
    features,
    constraints,
    unknowns,
    rawOutput: output,
  };
}
