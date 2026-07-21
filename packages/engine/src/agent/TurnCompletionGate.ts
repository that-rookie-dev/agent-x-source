import type { TodoItem } from '@agentx/shared';

/** Hard cap on coded continuation rounds after the model first tries to end the turn. */
export const MAX_COMPLETION_CONTINUATIONS = 6;

export type IncompleteTodo = {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress';
};

export type TurnCompletionBlockReason =
  | {
    kind: 'incomplete_todos';
    incomplete: IncompleteTodo[];
    completed: number;
    total: number;
  }
  | {
    kind: 'planning_gap';
    estimatedTasks: number;
    checklistSize: number;
  };

export type TurnCompletionGateResult =
  | { block: false }
  | { block: true; reason: TurnCompletionBlockReason };

/**
 * Count clearly enumerated work items in the user request.
 * Used only as a planning-gap signal when the checklist was never created.
 */
export function estimateEnumeratedTaskCount(userText: string): number {
  const text = (userText || '').trim();
  if (!text) return 0;

  const lines = text.split(/\n/);
  let count = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 6) continue;
    // 1. Task / 1) Task / 1 - Task / Task 1: ...
    if (/^(?:\d{1,2}[.):]\s+|\d{1,2}\s+[-–—]\s+|[-*•]\s+(?:\*\*[^*]+\*\*\s*)?|task\s*\d{1,2}\s*[:.\-–—]\s*)/i.test(line)) {
      count += 1;
    }
  }

  // Fallback: "do A, B, C, D, and E" style is too ambiguous — skip.
  // Numbered inline "1) ... 2) ... 3) ..." in one paragraph:
  if (count === 0) {
    const inline = text.match(/(?:^|[\s;])\d{1,2}[.)]\s+\S.{8,}/g);
    if (inline && inline.length >= 3) count = inline.length;
  }

  return count;
}

export function getIncompleteTodos(items: TodoItem[]): IncompleteTodo[] {
  return items
    .filter((t) => t.status === 'not-started' || t.status === 'in-progress')
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status as 'not-started' | 'in-progress',
    }));
}

export function isChecklistFullyComplete(items: TodoItem[]): boolean {
  if (items.length === 0) return true;
  return items.every((t) => t.status === 'completed');
}

/**
 * Diamond rule: the turn must not finalize while planned work is unfinished,
 * or when a clearly multi-task request never received a checklist.
 */
export function evaluateTurnCompletionGate(opts: {
  todos: TodoItem[];
  userText: string;
  /** Continuations already run for this turn (0 = first evaluation after model stop). */
  completionRound: number;
  /** Skip planning-gap after the model has had a chance to create a checklist. */
  maxPlanningGapRounds?: number;
  minTasksForPlanningGap?: number;
}): TurnCompletionGateResult {
  const todos = opts.todos ?? [];
  const incomplete = getIncompleteTodos(todos);
  if (incomplete.length > 0) {
    const completed = todos.filter((t) => t.status === 'completed').length;
    return {
      block: true,
      reason: {
        kind: 'incomplete_todos',
        incomplete,
        completed,
        total: todos.length,
      },
    };
  }

  const minTasks = opts.minTasksForPlanningGap ?? 3;
  const maxPlanRounds = opts.maxPlanningGapRounds ?? 2;
  const estimated = estimateEnumeratedTaskCount(opts.userText);
  if (
    estimated >= minTasks
    && todos.length === 0
    && opts.completionRound < maxPlanRounds
  ) {
    return {
      block: true,
      reason: {
        kind: 'planning_gap',
        estimatedTasks: estimated,
        checklistSize: 0,
      },
    };
  }

  // Checklist exists but is far smaller than a clearly enumerated multi-task ask.
  if (
    estimated >= minTasks
    && todos.length > 0
    && todos.length < estimated
    && isChecklistFullyComplete(todos)
    && opts.completionRound < maxPlanRounds
  ) {
    return {
      block: true,
      reason: {
        kind: 'planning_gap',
        estimatedTasks: estimated,
        checklistSize: todos.length,
      },
    };
  }

  return { block: false };
}

/** System-level user message that forces the model to finish remaining work. */
export function buildCompletionContinuationPrompt(reason: TurnCompletionBlockReason): string {
  if (reason.kind === 'incomplete_todos') {
    const lines = reason.incomplete.map((t) => {
      const mark = t.status === 'in-progress' ? '[~]' : '[ ]';
      return `${mark} #${t.id} ${t.title}`;
    });
    return [
      '[PLATFORM COMPLETION GATE — DO NOT IGNORE]',
      `Checklist is incomplete: ${reason.completed}/${reason.total} done. ${reason.incomplete.length} item(s) still open.`,
      'You attempted to end the turn early. That is not allowed.',
      'Required actions NOW:',
      '1. Keep or mark open items in_progress (parallel streams allowed).',
      '2. Finish EVERY open item — use delegate_to_subagent in parallel when independent; as slots free, spawn the next pending items immediately.',
      '3. After each finish: todo_write(merge:true) mark completed and start the next pending item(s).',
      '4. Do NOT write a final user summary until every checklist item is completed.',
      '5. Do NOT delete or shrink the checklist to escape this gate.',
      '',
      'OPEN ITEMS:',
      ...lines,
      '[/PLATFORM COMPLETION GATE]',
    ].join('\n');
  }

  return [
    '[PLATFORM COMPLETION GATE — PLANNING GAP]',
    `The user request enumerates about ${reason.estimatedTasks} distinct tasks, but the TASKS checklist has ${reason.checklistSize} item(s).`,
    'Required actions NOW:',
    '1. Call todo_write(merge:false) with a FULL checklist covering every user-requested task (do not omit any).',
    '2. Mark the first wave in_progress (parallel allowed) and execute — spawn sub-agents for independent work.',
    '3. As agents finish, immediately start remaining pending items until the checklist is 100% completed.',
    '4. Do NOT end with a partial summary.',
    '[/PLATFORM COMPLETION GATE]',
  ].join('\n');
}

/** User-visible footer when the gate hits its continuation cap. */
export function buildIncompleteTurnFooter(incomplete: IncompleteTodo[]): string {
  if (incomplete.length === 0) return '';
  const lines = incomplete.map((t) => `- #${t.id} ${t.title} (${t.status})`);
  return [
    '',
    '---',
    `⚠️ Checklist still open (${incomplete.length} item(s)). Send **continue** to finish:`,
    ...lines,
  ].join('\n');
}
