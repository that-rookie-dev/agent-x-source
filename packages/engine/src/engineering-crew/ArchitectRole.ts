import { getLogger } from '@agentx/shared';
import { CrewRole } from './CrewRole.js';
import type { EngineeringCrewMessage, DesignDocument, PrdDocument, CrewTopic } from './types.js';
import { broadcastMessage } from './types.js';
import { extractJsonObject } from './json-extract.js';
import type { SubAgentSpawner } from './SubAgentSpawner.js';

const ARCHITECT_TOOLS = ['file_read', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'web_search', 'web_fetch', 'deep_web_search', 'shell_exec', 'terminal_start', 'terminal_read', 'terminal_list'];

/**
 * Architect role — mirrors MetaGPT's `Architect`
 * (repos/metagpt/metagpt/roles/architect.py).
 *
 * Watches `prd_ready` (produced by ProductManager), produces a System Design Document via
 * the `WriteDesign` action (delegated to an LLM sub-agent), and publishes it on the
 * `design_ready` topic for the ProjectManager to consume.
 *
 * SOP pipeline step:
 *   UserRequirement → WritePRD → **WriteDesign** → WriteTasks → WriteCode → ...
 *
 * The design includes architecture, components, data models, and tech stack — enough
 * detail for the ProjectManager to decompose into concrete tasks.
 */
export class ArchitectRole extends CrewRole {
  readonly name = 'Architect';
  protected readonly watchedTopics: Set<CrewTopic> = new Set(['prd_ready']);

  constructor(private readonly spawner: SubAgentSpawner, _taskId: string) {
    super();
    void _taskId;
  }

  protected async act(messages: EngineeringCrewMessage[]): Promise<void> {
    // #4: On resume, skip if a design already exists in the environment
    const existingDesign = this.environment?.messagesByTopic('design_ready').pop();
    if (existingDesign) {
      getLogger().info('ENGINEERING_CREW', 'Architect skipping design generation — design already exists in environment');
      return;
    }

    const latest = messages[messages.length - 1]!;
    const prd = latest.artifact as PrdDocument | undefined;
    if (!prd) return;

    getLogger().info('ENGINEERING_CREW', `Architect producing system design for: ${prd.productName}`);

    const instruction = buildDesignInstruction(prd);
    const result = await this.spawner.spawnAndWait(instruction, ARCHITECT_TOOLS, 'architect', 300_000);

    const design = parseDesign(result.output, prd);

    if (!design) {
      getLogger().warn('ENGINEERING_CREW', 'Architect failed to produce a parseable design; escalating.');
      this.publish(broadcastMessage(
        'unknown_escalated',
        this.name,
        'The Architect could not produce a structured system design. Manual design is needed.',
      ));
      return;
    }

    this.publish(broadcastMessage('design_ready', this.name, `System design created with ${design.components.length} component(s).`, design));
  }
}

function buildDesignInstruction(prd: PrdDocument): string {
  const features = prd.features.map((f) => `- [${f.priority}] ${f.name}: ${f.description}`).join('\n');
  const constraints = prd.constraints.length > 0 ? prd.constraints.map((c) => `- ${c}`).join('\n') : '(none)';
  const unknowns = prd.unknowns && prd.unknowns.length > 0
    ? `\nKnown unknowns from PRD (you MUST research these and resolve them in your design):\n${prd.unknowns.map((u) => `- ${u}`).join('\n')}`
    : '';

  return `You are the Architect on a software engineering team. The Product Manager has produced this PRD:

Product: ${prd.productName}
Original requirement: ${prd.originalRequirement}

Features:
${features}

Constraints:
${constraints}${unknowns}

BEFORE writing the design, you MUST research the technical landscape:
1. Use shell_exec or terminal_start to check what's installed in the environment (runtimes, build tools, package managers).
2. Use folder_tree/folder_list/file_read to inspect any existing codebase — understand current patterns, conventions, and dependencies.
3. Use web_search to research each technology in the tech stack — verify it supports the required features, check for known issues/limitations, and find the correct API usage.
4. For each unknown from the PRD, use web_search to find the answer. If you can't resolve an unknown, carry it forward into the design's unknowns list.
5. If the requirement involves a specific model, library, or framework, research its exact configuration requirements, API surface, and known pitfalls.

Only after researching, produce a System Design Document as JSON (and nothing else — no prose, no markdown fences) with this exact shape:

{
  "architecture": "<high-level architecture description, 2-4 sentences>",
  "components": [
    {
      "name": "<component name>",
      "description": "<what this component does>",
      "responsibilities": ["<specific responsibility>", ...],
      "interfaces": ["<API endpoint / function signature / interface description>", ...]
    }
  ],
  "dataModels": ["<data model description>", ...],
  "techStack": ["<technology/library/framework with specific version>", ...],
  "constraints": ["<technical constraint from the design>", ...],
  "unknowns": ["<anything that still needs verification before implementation>", ...]
}

Rules:
- Design a simple, clean architecture — do not over-engineer.
- Each component should have a single, clear responsibility.
- Interfaces should be concrete enough that a developer can implement them without further design input.
- The tech stack should list specific libraries/frameworks WITH versions, not vague categories.
- Base the design on what you discovered in your research, not assumptions.
- If a technology has known limitations that affect the design, list them as constraints.
- Carry forward any unresolved unknowns so the Engineer can research them during implementation.
- Output raw JSON only.`;
}

function parseDesign(output: string, prd: PrdDocument): DesignDocument | null {
  const json = extractJsonObject(output);
  if (!json) return null;

  const architecture = typeof json['architecture'] === 'string' ? json['architecture'] : '';
  const components = Array.isArray(json['components'])
    ? (json['components'] as unknown[])
        .map((c) => {
          const r = c as Record<string, unknown>;
          return {
            name: typeof r['name'] === 'string' ? r['name'] : 'Component',
            description: typeof r['description'] === 'string' ? r['description'] : '',
            responsibilities: Array.isArray(r['responsibilities'])
              ? (r['responsibilities'] as unknown[]).filter((x): x is string => typeof x === 'string')
              : [],
            interfaces: Array.isArray(r['interfaces'])
              ? (r['interfaces'] as unknown[]).filter((x): x is string => typeof x === 'string')
              : [],
          };
        })
    : [];
  const dataModels = Array.isArray(json['dataModels'])
    ? (json['dataModels'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const techStack = Array.isArray(json['techStack'])
    ? (json['techStack'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const constraints = Array.isArray(json['constraints'])
    ? (json['constraints'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const unknowns = Array.isArray(json['unknowns'])
    ? (json['unknowns'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  if (architecture.length === 0 && components.length === 0) return null;

  return {
    prdRef: prd.originalRequirement,
    architecture,
    components,
    dataModels,
    techStack,
    constraints,
    unknowns,
    rawOutput: output,
  };
}
