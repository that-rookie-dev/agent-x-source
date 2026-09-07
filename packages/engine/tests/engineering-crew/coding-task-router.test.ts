import { describe, it, expect } from 'vitest';
import { routeCodingTask } from '../../src/engineering-crew/CodingTaskRouter.js';
import type { CategoryResult } from '../../src/prompt/CategoryDetector.js';
import type { RouterContext } from '../../src/engineering-crew/CodingTaskRouter.js';

const codingCategory = (sub?: string): CategoryResult => ({
  primary: 'coding',
  sub,
  confidence: 0.9,
});

const researchCategory = (): CategoryResult => ({
  primary: 'research',
  confidence: 0.9,
});

describe('CodingTaskRouter', () => {
  it('routes substantial build requests to the Engineering Crew', async () => {
    const cases = [
      'Build a spring boot application with LiteRT-LM to load a LLM model and use a controller to post prompt and get response as JSON.',
      'Create a new React frontend project with TypeScript and Tailwind CSS.',
      'Implement a REST API service with authentication and database persistence.',
      'Set up a new Python CLI tool that processes CSV files and outputs JSON.',
      'Develop a full-stack web application from scratch with proper authentication.',
      'Scaffold a new microservice with Docker support and health checks.',
      'Build an end-to-end data pipeline with Airflow and Spark.',
    ];
    for (const c of cases) {
      const d = await routeCodingTask(c, codingCategory());
      expect(d.useEngineeringCrew, `expected crew for: ${c}`).toBe(true);
    }
  });

  it('routes trivial coding requests to the fast path', async () => {
    const cases = [
      'Fix the typo in utils.ts line 42.',
      'Add a console.log to debug the login flow.',
      'Rename the variable foo to bar in auth.ts.',
      'Quick fix: change the timeout from 5000 to 10000.',
      'Refactor this function to use async/await instead of promises.',
      'Convert this Python function to TypeScript.',
      'Write a unit test for the calculateTotal function.',
      'Explain how the authentication middleware works.',
      'Review the code in src/handlers/user.ts.',
      'Debug the crash in the payment processing module.',
    ];
    for (const c of cases) {
      const d = await routeCodingTask(c, codingCategory());
      expect(d.useEngineeringCrew, `expected fast path for: ${c}`).toBe(false);
    }
  });

  it('does not route non-coding categories to the crew', async () => {
    const d = await routeCodingTask('Build a comprehensive research report on climate change.', researchCategory());
    expect(d.useEngineeringCrew).toBe(false);
  });

  it('routes long multi-sentence coding requests to the crew even without explicit build signals', async () => {
    const longRequest = [
      'I need to create a new module for handling user notifications.',
      'It should support email, SMS, and push notifications.',
      'The module needs to integrate with our existing event system and persist notification state to the database.',
      'Please also add proper error handling and retry logic for failed deliveries.',
      'Make sure to include configuration for different notification providers.',
    ].join(' ');
    const d = await routeCodingTask(longRequest, codingCategory());
    expect(d.useEngineeringCrew).toBe(true);
  });

  it('defaults to fast path for short coding requests without substantial signals', async () => {
    const d = await routeCodingTask('Update the API endpoint to return 201 instead of 200.', codingCategory());
    expect(d.useEngineeringCrew).toBe(false);
  });

  it('handles edge category as a coding candidate', async () => {
    const d = await routeCodingTask('Build a new edge function for handling webhooks.', {
      primary: 'edge',
      confidence: 0.8,
    });
    expect(d.useEngineeringCrew).toBe(true);
  });

  // ─── Resume / context-aware routing ───

  describe('resume routing with prior incomplete run', () => {
    const incompleteCtx: RouterContext = {
      sessionId: 'sess-1',
      hasPriorRun: true,
      hasIncompleteRun: true,
      priorTaskId: 'eng-crew-prior-1',
      priorObjective: 'Build a REST API with authentication',
    };

    it('routes to crew with resume=true when a prior incomplete run exists and user says "continue"', async () => {
      const d = await routeCodingTask('continue with the implementation', codingCategory(), incompleteCtx);
      expect(d.useEngineeringCrew).toBe(true);
      expect(d.resumePriorRun).toBe(true);
      expect(d.priorTaskId).toBe('eng-crew-prior-1');
    });

    it('routes to crew with resume=true for semantic continuation without the word "continue"', async () => {
      // The user doesn't say "continue" — they semantically refer to prior work.
      // The router trusts that a prior incomplete run exists and lets the crew's
      // LLM (with full session context) understand what the user means.
      const cases = [
        'now add the authentication middleware',
        'fix the failing test in the user controller',
        'the build is broken, please check the compile errors',
        'add the missing CRUD endpoints for the posts resource',
        'wire up the database connection and run the migrations',
      ];
      for (const c of cases) {
        const d = await routeCodingTask(c, codingCategory(), incompleteCtx);
        expect(d.useEngineeringCrew, `expected resume for: ${c}`).toBe(true);
        expect(d.resumePriorRun, `expected resumePriorRun for: ${c}`).toBe(true);
      }
    });

    it('does not resume for trivial requests even when a prior run exists', async () => {
      const cases = [
        'Fix the typo in utils.ts line 42.',
        'Rename the variable foo to bar in auth.ts.',
        'Explain how the authentication middleware works.',
      ];
      for (const c of cases) {
        const d = await routeCodingTask(c, codingCategory(), incompleteCtx);
        expect(d.useEngineeringCrew, `expected fast path for: ${c}`).toBe(false);
      }
    });

    it('does not resume when no prior incomplete run exists', async () => {
      const ctxNoIncomplete: RouterContext = {
        sessionId: 'sess-1',
        hasPriorRun: true,
        hasIncompleteRun: false,
      };
      const d = await routeCodingTask('add more tests', codingCategory(), ctxNoIncomplete);
      // No incomplete run → no resume signal; falls through to normal routing
      expect(d.resumePriorRun).toBeUndefined();
    });

    it('does not resume for non-coding categories even with prior run', async () => {
      const d = await routeCodingTask('continue the research', researchCategory(), incompleteCtx);
      expect(d.useEngineeringCrew).toBe(false);
    });
  });
});
