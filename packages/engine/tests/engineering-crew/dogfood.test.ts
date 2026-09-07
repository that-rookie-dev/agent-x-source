import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EngineeringCrew } from '../../src/engineering-crew/EngineeringCrew.js';
import type { SubAgentSpawner } from '../../src/engineering-crew/SubAgentSpawner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `agentx-eng-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

class FakeSpawner implements SubAgentSpawner {
  calls: Array<{ instruction: string; typeId: string }> = [];
  constructor(private readonly responses: Record<string, (callCount: number) => { success: boolean; output: string }>) {}

  async spawnAndWait(instruction: string, _tools: string[], typeId: string) {
    this.calls.push({ instruction, typeId });
    const responder = this.responses[typeId];
    if (!responder) return { success: false, output: `no fake response for ${typeId}` };
    const count = this.calls.filter((c) => c.typeId === typeId).length;
    return responder(count);
  }
}

function npmProject(cwd: string, testScript: string): void {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({
    name: 'fixture',
    scripts: { build: 'echo built', test: testScript },
  }));
}

/** Standard SOP responses for a simple passing project. */
function passingResponses() {
  return {
    product_manager: () => ({ success: true, output: JSON.stringify({ productName: 'Test', features: [{ name: 'Core', description: 'Core', priority: 'high' }], constraints: [] }) }),
    architect: () => ({ success: true, output: JSON.stringify({ architecture: 'simple', components: [{ name: 'Main', description: 'main', responsibilities: ['impl'], interfaces: ['main()'] }], dataModels: [], techStack: ['Node.js'], constraints: [] }) }),
    project_manager: () => ({ success: true, output: JSON.stringify({ tasks: [{ id: 'task-1', title: 'Setup', description: 'setup', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] }] }) }),
    engineer: () => ({ success: true, output: 'console.log("hello");' }),
    qa_engineer: () => ({ success: true, output: 'test passes' }),
    verifier: () => ({ success: true, output: 'PASS: npm test passes — ok' }),
    reviewer: () => ({ success: true, output: 'PASSED: yes\nSUMMARY: All files verified, build and tests pass.\nEVIDENCE: npm test → exit 0' }),
  };
}

/**
 * Generic pipeline tests — verify the Engineering Crew SOP pipeline handles common
 * software-engineering scenarios without any real LLM calls.
 */
describe('Engineering Crew — pipeline scenarios', () => {

  describe('simple passing project', () => {
    it('completes a single-task project where build and test pass', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner(passingResponses());

      const crew = new EngineeringCrew(spawner, tmpDir, 'simple-pass');
      crew.kickoff('Create a simple project');
      const result = await crew.run(20, 60_000);

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe('failing project', () => {
    it('does not claim success when tests always fail', async () => {
      npmProject(tmpDir, 'exit 1');
      const spawner = new FakeSpawner(passingResponses());

      const crew = new EngineeringCrew(spawner, tmpDir, 'simple-fail');
      crew.kickoff('Create a project whose tests fail');
      const result = await crew.run(20, 120_000);

      expect(result.success).toBe(false);
    }, 120_000);
  });

  describe('unresolved unknown', () => {
    it('does not call the Engineer when a task has an unresolved unknown', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner({
        ...passingResponses(),
        project_manager: () => ({
          success: true,
          output: JSON.stringify({
            tasks: [{
              id: 'task-1', title: 'Blocked', description: 'blocked',
              dependsOn: [], acceptanceCriteria: ['n/a'],
              unknowns: [{ question: 'Does the required library exist?' }],
            }],
          }),
        }),
        engineer: () => ({ success: true, output: 'should never be called' }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'unknown-block');
      crew.kickoff('A task with an unknown');
      const result = await crew.run(10, 15_000);

      expect(spawner.calls.some((c) => c.typeId === 'engineer')).toBe(false);
      expect(result.success).toBe(false);
    }, 30_000);
  });

  describe('ProductManager failure', () => {
    it('escalates when the ProductManager fails to produce a PRD', async () => {
      const spawner = new FakeSpawner({
        product_manager: () => ({ success: false, output: 'cannot produce PRD' }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'pm-fail');
      crew.kickoff('An impossible request');
      const result = await crew.run(5, 15_000);

      expect(result.success).toBe(false);
      expect(spawner.calls.some((c) => c.typeId === 'architect')).toBe(false);
    }, 30_000);
  });

  describe('Architect failure', () => {
    it('escalates when the Architect fails to produce a design', async () => {
      const spawner = new FakeSpawner({
        ...passingResponses(),
        architect: () => ({ success: false, output: 'cannot produce design' }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'arch-fail');
      crew.kickoff('A task with impossible architecture');
      const result = await crew.run(5, 15_000);

      expect(result.success).toBe(false);
      expect(spawner.calls.some((c) => c.typeId === 'project_manager')).toBe(false);
    }, 30_000);
  });

  describe('multi-task with dependencies', () => {
    it('completes a two-task project where task-2 depends on task-1', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner({
        ...passingResponses(),
        project_manager: () => ({
          success: true,
          output: JSON.stringify({
            tasks: [
              { id: 'task-1', title: 'Setup', description: 'setup', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] },
              { id: 'task-2', title: 'Feature', description: 'feature', dependsOn: ['task-1'], acceptanceCriteria: ['npm test passes'], unknowns: [] },
            ],
          }),
        }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'multi-task');
      crew.kickoff('Build a two-task project with dependencies');
      const result = await crew.run(40, 60_000);

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe('three independent tasks', () => {
    it('runs three independent tasks and verifies all of them', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner({
        ...passingResponses(),
        project_manager: () => ({
          success: true,
          output: JSON.stringify({
            tasks: [
              { id: 'task-a', title: 'A', description: 'a', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] },
              { id: 'task-b', title: 'B', description: 'b', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] },
              { id: 'task-c', title: 'C', description: 'c', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] },
            ],
          }),
        }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'three-tasks');
      crew.kickoff('Build three independent modules');
      const result = await crew.run(20, 60_000);

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe('live endpoint criterion', () => {
    it('fails verification when an endpoint is not reachable', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner({
        ...passingResponses(),
        project_manager: () => ({
          success: true,
          output: JSON.stringify({
            tasks: [{
              id: 'task-1', title: 'API', description: 'api',
              dependsOn: [],
              acceptanceCriteria: [
                'npm test passes',
                'GET http://127.0.0.1:1/api/health returns real data',
              ],
              unknowns: [],
            }],
          }),
        }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'endpoint-unreachable');
      crew.kickoff('Build an API endpoint');
      const result = await crew.run(30, 120_000);

      expect(result.success).toBe(false);
    }, 120_000);
  });

  describe('empty task list', () => {
    it('does not claim success when the task list has zero tasks', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner({
        ...passingResponses(),
        project_manager: () => ({
          success: true,
          output: JSON.stringify({ tasks: [] }),
        }),
      });

      const crew = new EngineeringCrew(spawner, tmpDir, 'empty-tasks');
      crew.kickoff('A task with no work');
      const result = await crew.run(5, 15_000);

      expect(result.success).toBe(false);
      expect(spawner.calls.some((c) => c.typeId === 'engineer')).toBe(false);
    }, 30_000);
  });

  describe('serialization', () => {
    it('can serialize and deserialize crew state', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner(passingResponses());

      const crew = new EngineeringCrew(spawner, tmpDir, 'serialize-test');
      crew.kickoff('Create a project');
      await crew.run(5, 30_000);

      const serialized = crew.serialize();
      expect(serialized).toContain('serialize-test');

      const deserialized = EngineeringCrew.deserialize(serialized);
      expect(deserialized.taskId).toBe('serialize-test');
    }, 60_000);
  });

  describe('incremental mode', () => {
    it('scans existing files in incremental mode', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'existing', scripts: { build: 'echo built', test: 'exit 0' } }));
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      writeFileSync(join(tmpDir, 'src', 'index.js'), 'console.log("existing");');

      const spawner = new FakeSpawner(passingResponses());
      const crew = new EngineeringCrew(spawner, tmpDir, 'incremental-test', { incremental: true });
      crew.kickoff('Add a feature to the existing project');
      const result = await crew.run(20, 60_000);

      // Should complete successfully
      expect(result.success).toBe(true);
    }, 60_000);
  });

  // ─── Resume from prior plan ───

  describe('resume from prior plan', () => {
    it('resumes from a prior plan with verified + unverified phases', async () => {
      npmProject(tmpDir, 'exit 0');
      const spawner = new FakeSpawner(passingResponses());

      // Simulate a prior plan: 2 tasks, task-1 verified, task-2 pending
      const priorPlan = {
        taskId: 'eng-crew-prior-resume-1',
        objective: 'Build a two-task project',
        acceptanceCriteria: [],
        phases: [
          {
            id: 'task-1',
            title: 'Setup',
            status: 'verified',
            dependsOn: [],
            acceptanceCriteria: ['npm test passes'],
            unknowns: [],
            verification: [{ criterion: 'npm test passes', passed: true, detail: 'ok' }],
            retryCount: 0,
          },
          {
            id: 'task-2',
            title: 'Feature',
            status: 'pending',
            dependsOn: ['task-1'],
            acceptanceCriteria: ['npm test passes'],
            unknowns: [],
            verification: [],
            retryCount: 0,
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        taskList: {
          designRef: '',
          tasks: [
            { id: 'task-1', title: 'Setup', description: 'setup', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [], status: 'verified' },
            { id: 'task-2', title: 'Feature', description: 'feature', dependsOn: ['task-1'], acceptanceCriteria: ['npm test passes'], unknowns: [], status: 'pending' },
          ],
          rawOutput: '',
        },
      };

      const crew = new EngineeringCrew(spawner, tmpDir, 'eng-crew-prior-resume-1');
      crew.setSessionContext({
        sessionId: 'test-session',
        conversationHistory: [
          { role: 'user', content: 'Build a two-task project' },
          { role: 'assistant', content: 'Task-1 is done, task-2 is pending.' },
        ],
        priorPlan,
        latestUserMessage: 'continue with task-2',
      });
      crew.resume(priorPlan, 'continue with task-2');
      const result = await crew.run(30, 60_000);

      expect(result.success).toBe(true);
    }, 60_000);

    it('injects session context into LLM instructions via ContextAwareSpawner', async () => {
      npmProject(tmpDir, 'exit 0');

      // Custom spawner that captures instructions to verify context prefix is injected
      const capturedInstructions: string[] = [];
      const baseSpawner: SubAgentSpawner = {
        async spawnAndWait(instruction: string, _tools: string[], typeId: string) {
          capturedInstructions.push(instruction);
          if (typeId === 'product_manager') {
            return { success: true, output: JSON.stringify({ productName: 'Test', features: [{ name: 'X', description: 'X', priority: 'high' }], constraints: [] }) };
          }
          if (typeId === 'architect') {
            return { success: true, output: JSON.stringify({ architecture: 'simple', components: [{ name: 'C', description: 'c', responsibilities: ['r'], interfaces: ['i'] }], dataModels: [], techStack: [], constraints: [] }) };
          }
          if (typeId === 'project_manager') {
            return { success: true, output: JSON.stringify({ tasks: [{ id: 'task-1', title: 'Setup', description: 'setup', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] }] }) };
          }
          if (typeId === 'engineer') return { success: true, output: 'console.log("hello");' };
          if (typeId === 'qa_engineer') return { success: true, output: 'test passes' };
          if (typeId === 'verifier') return { success: true, output: 'PASS: npm test passes — ok' };
          return { success: false, output: 'unknown' };
        },
      };

      const crew = new EngineeringCrew(baseSpawner, tmpDir, 'ctx-inject-test');
      crew.setSessionContext({
        sessionId: 'test-session',
        conversationHistory: [
          { role: 'user', content: 'Build a project with auth' },
          { role: 'assistant', content: 'I started building it.' },
        ],
        priorPlan: null,
        latestUserMessage: 'now add the API endpoints',
      });
      crew.kickoff('now add the API endpoints');
      await crew.run(20, 60_000);

      // Every captured instruction should contain the context prefix
      const pmInstruction = capturedInstructions.find((i) => i.includes('ProductManager') || i.includes('PRD') || i.includes('product'));
      expect(pmInstruction).toBeDefined();
      // The context prefix should include the conversation history
      expect(capturedInstructions.some((i) => i.includes('Build a project with auth'))).toBe(true);
      expect(capturedInstructions.some((i) => i.includes('now add the API endpoints'))).toBe(true);
    }, 60_000);
  });
});
