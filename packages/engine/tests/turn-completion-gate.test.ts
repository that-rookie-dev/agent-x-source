import { describe, expect, it } from 'vitest';
import {
  buildCompletionContinuationPrompt,
  buildIncompleteTurnFooter,
  estimateEnumeratedTaskCount,
  evaluateTurnCompletionGate,
  getIncompleteTodos,
  isChecklistFullyComplete,
} from '../src/agent/TurnCompletionGate.js';
import type { TodoItem } from '@agentx/shared';

function todos(rows: Array<[number, string, TodoItem['status']]>): TodoItem[] {
  return rows.map(([id, title, status]) => ({ id, title, status }));
}

describe('estimateEnumeratedTaskCount', () => {
  it('counts numbered multi-task requests', () => {
    const text = [
      'Please do all of these:',
      '1. Research competitor pricing',
      '2. Draft a comparison matrix',
      '3. Write a recommendation memo',
      '4. Prepare slides',
      '5. Outline next steps',
    ].join('\n');
    expect(estimateEnumeratedTaskCount(text)).toBe(5);
  });

  it('returns 0 for unstructured prose', () => {
    expect(estimateEnumeratedTaskCount('Can you help me think through this idea briefly?')).toBe(0);
  });
});

describe('evaluateTurnCompletionGate', () => {
  it('blocks when checklist items remain open', () => {
    const result = evaluateTurnCompletionGate({
      todos: todos([
        [1, 'A', 'completed'],
        [2, 'B', 'completed'],
        [3, 'C', 'in-progress'],
        [4, 'D', 'not-started'],
        [5, 'E', 'not-started'],
      ]),
      userText: 'do five things',
      completionRound: 0,
    });
    expect(result.block).toBe(true);
    if (!result.block) return;
    expect(result.reason.kind).toBe('incomplete_todos');
    if (result.reason.kind === 'incomplete_todos') {
      expect(result.reason.incomplete).toHaveLength(3);
      expect(result.reason.completed).toBe(2);
    }
  });

  it('allows turn end when all todos completed', () => {
    const result = evaluateTurnCompletionGate({
      todos: todos([
        [1, 'A', 'completed'],
        [2, 'B', 'completed'],
        [3, 'C', 'completed'],
      ]),
      userText: '1. A\n2. B\n3. C',
      completionRound: 0,
    });
    expect(result.block).toBe(false);
  });

  it('blocks planning gap when multi-task ask has empty checklist', () => {
    const result = evaluateTurnCompletionGate({
      todos: [],
      userText: [
        '1. Build the API',
        '2. Write tests',
        '3. Add docs',
        '4. Ship deploy',
      ].join('\n'),
      completionRound: 0,
    });
    expect(result.block).toBe(true);
    if (!result.block) return;
    expect(result.reason.kind).toBe('planning_gap');
  });

  it('blocks when checklist covers fewer enumerated tasks than requested', () => {
    const result = evaluateTurnCompletionGate({
      todos: todos([
        [1, 'A', 'completed'],
        [2, 'B', 'completed'],
      ]),
      userText: [
        '1. Research',
        '2. Design',
        '3. Implement',
        '4. Test',
        '5. Document',
      ].join('\n'),
      completionRound: 0,
    });
    expect(result.block).toBe(true);
    if (!result.block) return;
    expect(result.reason.kind).toBe('planning_gap');
    if (result.reason.kind === 'planning_gap') {
      expect(result.reason.estimatedTasks).toBe(5);
      expect(result.reason.checklistSize).toBe(2);
    }
  });

  it('stops planning-gap after max rounds so empty simple turns can finish', () => {
    const result = evaluateTurnCompletionGate({
      todos: [],
      userText: '1. One\n2. Two\n3. Three',
      completionRound: 2,
      maxPlanningGapRounds: 2,
    });
    expect(result.block).toBe(false);
  });
});

describe('prompt helpers', () => {
  it('lists open items in continuation prompt', () => {
    const prompt = buildCompletionContinuationPrompt({
      kind: 'incomplete_todos',
      incomplete: [
        { id: 4, title: 'Prepare slides', status: 'not-started' },
        { id: 5, title: 'Outline next steps', status: 'not-started' },
      ],
      completed: 3,
      total: 5,
    });
    expect(prompt).toContain('PLATFORM COMPLETION GATE');
    expect(prompt).toContain('#4 Prepare slides');
    expect(prompt).toContain('3/5 done');
  });

  it('builds footer for exhausted gate', () => {
    const footer = buildIncompleteTurnFooter([
      { id: 4, title: 'Prepare slides', status: 'not-started' },
    ]);
    expect(footer).toContain('continue');
    expect(footer).toContain('#4 Prepare slides');
  });
});

describe('checklist helpers', () => {
  it('getIncompleteTodos / isChecklistFullyComplete', () => {
    const items = todos([
      [1, 'A', 'completed'],
      [2, 'B', 'not-started'],
    ]);
    expect(getIncompleteTodos(items)).toHaveLength(1);
    expect(isChecklistFullyComplete(items)).toBe(false);
    expect(isChecklistFullyComplete(todos([[1, 'A', 'completed']]))).toBe(true);
    expect(isChecklistFullyComplete([])).toBe(true);
  });
});
