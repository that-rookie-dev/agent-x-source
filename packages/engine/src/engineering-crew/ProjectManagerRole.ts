import { getLogger } from '@agentx/shared';
import { CrewRole } from './CrewRole.js';
import type { EngineeringCrewMessage, DesignDocument, TaskList, Task, CrewTopic } from './types.js';
import { broadcastMessage } from './types.js';
import { extractJsonObject } from './json-extract.js';
import type { SubAgentSpawner } from './SubAgentSpawner.js';

const PM_TOOLS = ['file_read', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'web_search', 'web_fetch', 'deep_web_search', 'shell_exec'];

/**
 * Project Manager role — mirrors MetaGPT's `ProjectManager`
 * (repos/metagpt/metagpt/roles/project_manager.py).
 *
 * Watches `design_ready` (produced by Architect), produces a Task List via the `WriteTasks`
 * action (delegated to an LLM sub-agent), and publishes it on the `task_list_ready` topic
 * for the Engineer to consume.
 *
 * SOP pipeline step:
 *   UserRequirement → WritePRD → WriteDesign → **WriteTasks** → WriteCode → ...
 *
 * The task list decomposes the design into concrete, independently-implementable tasks
 * with dependencies, acceptance criteria, and unknowns — the same structure MetaGPT's
 * `WriteTasks` produces, adapted to Agent-X's `Task` type.
 */
export class ProjectManagerRole extends CrewRole {
  readonly name = 'ProjectManager';
  protected readonly watchedTopics: Set<CrewTopic> = new Set(['design_ready']);

  constructor(private readonly spawner: SubAgentSpawner) {
    super();
  }

  protected async act(messages: EngineeringCrewMessage[]): Promise<void> {
    // #4: On resume, skip if a task list already exists in the environment with tasks
    const existingTaskList = this.environment?.messagesByTopic('task_list_ready').pop();
    if (existingTaskList) {
      const tl = existingTaskList.artifact as TaskList | undefined;
      if (tl && tl.tasks.length > 0) {
        getLogger().info('ENGINEERING_CREW', 'ProjectManager skipping task list generation — task list already exists in environment');
        return;
      }
    }

    const latest = messages[messages.length - 1]!;
    const design = latest.artifact as DesignDocument | undefined;
    if (!design) return;

    getLogger().info('ENGINEERING_CREW', `ProjectManager producing task list from design with ${design.components.length} component(s)`);

    const instruction = buildTaskListInstruction(design);
    const result = await this.spawner.spawnAndWait(instruction, PM_TOOLS, 'project_manager', 300_000);

    const taskList = parseTaskList(result.output, design);

    if (!taskList || taskList.tasks.length === 0) {
      getLogger().warn('ENGINEERING_CREW', 'ProjectManager failed to produce a parseable task list; escalating.');
      this.publish(broadcastMessage(
        'unknown_escalated',
        this.name,
        'The ProjectManager could not decompose the design into tasks. Manual task decomposition is needed.',
      ));
      return;
    }

    this.publish(broadcastMessage(
      'task_list_ready',
      this.name,
      `Task list created with ${taskList.tasks.length} task(s).`,
      taskList,
    ));
  }
}

function buildTaskListInstruction(design: DesignDocument): string {
  const components = design.components.map((c) =>
    `Component: ${c.name}\n  Description: ${c.description}\n  Responsibilities: ${c.responsibilities.join(', ')}\n  Interfaces: ${c.interfaces.join(', ')}`
  ).join('\n\n');
  const techStack = design.techStack.length > 0 ? design.techStack.join(', ') : '(not specified)';
  const designUnknowns = design.unknowns && design.unknowns.length > 0
    ? `\nUnknowns from design (assign each to the relevant task):\n${design.unknowns.map((u) => `- ${u}`).join('\n')}`
    : '';

  return `You are the Project Manager on a software engineering team. The Architect has produced this system design:

Architecture: ${design.architecture}

Tech Stack: ${techStack}

Components:
${components}

Data Models: ${design.dataModels.join('; ') || '(none)'}${designUnknowns}

BEFORE writing the task list, inspect the existing codebase:
1. Use shell_exec to check the project structure (e.g. "ls -la", "find . -name '*.java' -o -name '*.py' -o -name '*.ts' | head -50").
2. Use folder_tree to understand the directory layout.
3. Use file_read to check existing build files (pom.xml, package.json, build.gradle, etc.) for dependencies and build commands.

Then produce a task list as JSON (and nothing else — no prose, no markdown fences) with this exact shape:

{
  "tasks": [
    {
      "id": "task-1",
      "title": "<short task title>",
      "description": "<what to implement in this task>",
      "dependsOn": [],
      "acceptanceCriteria": ["<literal, checkable statement>", ...],
      "filename": "<expected output filename, e.g. src/main.py>",
      "unknowns": [
        { "question": "<anything that must be verified before this task can be implemented safely>" }
      ]
    }
  ]
}

Rules:
- Break the work into the smallest set of independently-implementable, independently-verifiable tasks. Prefer 2-8 tasks.
- MAXIMIZE PARALLELISM: tasks with no dependencies on each other should have empty dependsOn arrays so they can be implemented in parallel. Only add a dependency when task B literally cannot start until task A is verified.
- Verify the dependency graph is acyclic — no task should depend (directly or transitively) on itself.
- Every task MUST have at least one concrete, checkable acceptance criterion — not "implement X" but "X returns/produces/does Y, verified by Z".
- "dependsOn" lists the ids of tasks that must be fully verified before this task can start (leave empty if independent).
- If you are not certain some external dependency, API, or library actually supports what's needed, list it as an "unknown" on the relevant task.
- Each task should produce a single file or a small, cohesive set of files.
- Assign each unknown from the design to the most relevant task.
- Order tasks topologically: tasks with no dependencies first, then tasks that depend on those, etc.
- Output raw JSON only.`;
}

function parseTaskList(output: string, design: DesignDocument): TaskList | null {
  const json = extractJsonObject(output);
  if (!json) return null;

  const rawTasks = Array.isArray(json['tasks']) ? json['tasks'] : [];
  if (rawTasks.length === 0) return null;

  const tasks: Task[] = rawTasks.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    return {
      id: typeof r['id'] === 'string' ? r['id'] : `task-${i + 1}`,
      title: typeof r['title'] === 'string' ? r['title'] : `Task ${i + 1}`,
      description: typeof r['description'] === 'string' ? r['description'] : '',
      dependsOn: Array.isArray(r['dependsOn'])
        ? (r['dependsOn'] as unknown[]).filter((d): d is string => typeof d === 'string')
        : [],
      acceptanceCriteria: Array.isArray(r['acceptanceCriteria'])
        ? (r['acceptanceCriteria'] as unknown[]).filter((c): c is string => typeof c === 'string')
        : [],
      filename: typeof r['filename'] === 'string' ? r['filename'] : undefined,
      unknowns: Array.isArray(r['unknowns'])
        ? (r['unknowns'] as unknown[])
          .map((u) => (u && typeof u === 'object' ? (u as Record<string, unknown>) : null))
          .filter((u): u is Record<string, unknown> => !!u && typeof u['question'] === 'string')
          .map((u) => ({ question: u['question'] as string }))
        : [],
      status: 'pending' as const,
      retryCount: 0,
    };
  });

  return {
    designRef: design.rawOutput,
    tasks,
    rawOutput: output,
  };
}
