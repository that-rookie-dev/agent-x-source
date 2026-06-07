import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { CrewOrchestrator, CrewMember } from './CrewOrchestrator.js';

export interface PlannedTask {
  id: string;
  description: string;
  skills: string[];
  assignedCrew?: { crewId: string; name: string; callsign: string };
  phase: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
}

export interface ExecutionPhase {
  phase: number;
  label: string;
  tasks: PlannedTask[];
}

export interface ExecutionPlan {
  summary: string;
  phases: ExecutionPhase[];
}

export class OrchestrationPlanner {
  private provider: ProviderInterface;
  private crewOrchestrator: CrewOrchestrator;

  constructor(provider: ProviderInterface, crewOrchestrator: CrewOrchestrator) {
    this.provider = provider;
    this.crewOrchestrator = crewOrchestrator;
  }

  /**
   * Decompose a user message into concrete tasks via LLM,
   * then match each task to the best available crew member.
   */
  async plan(userMessage: string, enabledCrews: CrewMember[]): Promise<ExecutionPlan> {
    const tasks = await this.decomposeTasks(userMessage);
    if (tasks.length < 2) {
      return { summary: userMessage, phases: [] };
    }

    const basic = tasks.map((t) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      description: t.description,
      skills: t.skills,
      assignedCrew: undefined as { crewId: string; name: string; callsign: string } | undefined,
      phase: 0,
      status: 'pending' as const,
      result: undefined as string | undefined,
    }));

    const assigned = basic.map((t) => ({
      ...t,
      assignedCrew: this.matchCrewToTask(t, enabledCrews),
    }));

    const phases = this.buildPhases(assigned);

    return {
      summary: userMessage,
      phases,
    };
  }

  /**
   * Execute a plan: runs crew tasks, returns aggregated results.
   * Tasks without crew assignment are marked as needing Agent-X.
   */
  async execute(
    plan: ExecutionPlan,
    routeToCrew: (member: CrewMember, message: string) => Promise<string>,
    onProgress?: (task: PlannedTask) => void,
  ): Promise<string> {
    const results: string[] = [];

    for (const phase of plan.phases) {
      const crewTasks = phase.tasks.filter((t) => t.assignedCrew);
      if (crewTasks.length === 0) continue;

      const phaseResults = await Promise.allSettled(
        crewTasks.map(async (task) => {
          task.status = 'running';
          onProgress?.(task);
          try {
            const member = this.crewOrchestrator.getMembers().find(
              (m) => m.crew.id === task.assignedCrew!.crewId,
            );
            if (!member) {
              task.status = 'failed';
              task.result = 'Crew member not found';
              return;
            }
            const result = await routeToCrew(member, task.description);
            task.status = 'done';
            task.result = result;
          } catch (e) {
            task.status = 'failed';
            task.result = e instanceof Error ? e.message : 'failed';
          }
        }),
      );

      for (const r of phaseResults) {
        if (r.status === 'fulfilled' && r.value !== undefined) {
          results.push(`## ${phase.label}\n\n${r.value}`);
        }
      }
    }

    // Unassigned tasks
    const unassigned = plan.phases.flatMap((p) =>
      p.tasks.filter((t) => !t.assignedCrew),
    );
    if (unassigned.length > 0) {
      const list = unassigned.map((t) => `- ${t.description} [needs: ${t.skills.join(', ')}]`).join('\n');
      results.push(`\n\n---\n\n**Pending tasks** (no matching crew available):\n\n${list}`);
    }

    return results.join('\n\n');
  }

  /**
   * Build a formatted plan summary for display to the user.
   */
  formatPlan(plan: ExecutionPlan): string {
    if (plan.phases.length === 0) return '';

    const lines: string[] = ['**Execution Plan**\n'];
    for (const phase of plan.phases) {
      lines.push(`### ${phase.label}`);
      for (const task of phase.tasks) {
        const assignee = task.assignedCrew
          ? `→ **${task.assignedCrew.name}** (@${task.assignedCrew.callsign})`
          : `→ [needs: ${task.skills.join(', ')}]`;
        lines.push(`- ${task.description} ${assignee}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ─── LLM Task Decomposition ───

  private async decomposeTasks(userMessage: string): Promise<Omit<PlannedTask, 'id' | 'assignedCrew' | 'phase' | 'status' | 'result'>[]> {
    const prompt = `Break down the following user request into concrete, actionable tasks. Each task should be specific and completable. Include the skills/expertise needed for each.

User request: "${userMessage.slice(0, 500)}"

Return ONLY a JSON array of objects with "task" and "skills" keys. No other text.
Example: [{"task":"Design database schema","skills":["database design","SQL"]},{"task":"Create React frontend","skills":["React","CSS","TypeScript"]}]`;

    try {
      const completion = this.provider.complete({
        model: '',  // uses provider default
        messages: [
          { role: 'system', content: 'You are a task decomposition engine. Output JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        maxTokens: 500,
      });

      let raw = '';
      for await (const chunk of completion) {
        if (chunk.content) raw += chunk.content;
      }

      const json = raw.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((t: Record<string, unknown>) => ({
        description: String(t['task'] ?? t['description'] ?? ''),
        skills: Array.isArray(t['skills']) ? t['skills'].map(String) : [],
      }));
    } catch {
      return [];
    }
  }

  // ─── Crew Matching for Tasks ───

  private matchCrewToTask(
    task: { description: string; skills: string[] },
    enabledCrews: CrewMember[],
  ): { crewId: string; name: string; callsign: string } | undefined {
    if (enabledCrews.length === 0) return undefined;

    const searchText = `${task.description} ${task.skills.join(' ')}`.toLowerCase();
    let best: { crew: CrewMember; score: number } | null = null;

    for (const c of enabledCrews) {
      let score = 0;
      const exp = c.expertise ?? [];
      for (const kw of exp) {
        const words = kw.toLowerCase().split(/[\s,;/]+/).filter((w) => w.length > 2);
        score += words.filter((w) => searchText.includes(w)).length * 2;
      }
      for (const skill of task.skills) {
        for (const kw of exp) {
          if (kw.toLowerCase().includes(skill.toLowerCase())) score += 3;
        }
      }
      const promptLower = c.crew.systemPrompt.toLowerCase();
      for (const skill of task.skills) {
        if (promptLower.includes(skill.toLowerCase())) score += 1;
      }
      if (score > (best?.score ?? 0)) best = { crew: c, score };
    }

    if (best && best.score >= 2) {
      return { crewId: best.crew.crew.id, name: best.crew.crew.name, callsign: best.crew.crew.callsign };
    }
    return undefined;
  }

  // ─── Phasing ───

  private buildPhases(tasks: PlannedTask[]): ExecutionPhase[] {
    if (tasks.length <= 3) {
      return [{ phase: 1, label: 'Tasks', tasks }];
    }

    const phaseLabels = ['Architecture & Planning', 'Core Development', 'Integration & Polish'];
    const perPhase = Math.ceil(tasks.length / phaseLabels.length);
    const phases: ExecutionPhase[] = [];

    for (let i = 0; i < phaseLabels.length; i++) {
      const phaseTasks = tasks.slice(i * perPhase, (i + 1) * perPhase);
      if (phaseTasks.length > 0) {
        for (const t of phaseTasks) t.phase = i + 1;
        phases.push({ phase: i + 1, label: phaseLabels[i]!, tasks: phaseTasks });
      }
    }

    return phases;
  }
}
