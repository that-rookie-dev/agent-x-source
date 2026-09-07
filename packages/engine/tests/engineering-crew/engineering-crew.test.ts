import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EngineeringCrew } from '../../src/engineering-crew/EngineeringCrew.js';
import { CrewEnvironment } from '../../src/engineering-crew/CrewEnvironment.js';
import { ProductManagerRole } from '../../src/engineering-crew/ProductManagerRole.js';
import { ArchitectRole } from '../../src/engineering-crew/ArchitectRole.js';
import { ProjectManagerRole } from '../../src/engineering-crew/ProjectManagerRole.js';
import { EngineerRole } from '../../src/engineering-crew/EngineerRole.js';
import { QaEngineerRole } from '../../src/engineering-crew/QaEngineerRole.js';
import { ReviewerRole } from '../../src/engineering-crew/ReviewerRole.js';
import { broadcastMessage, type TaskList, type PrdDocument, type DesignDocument } from '../../src/engineering-crew/types.js';
import type { SubAgentSpawner } from '../../src/engineering-crew/SubAgentSpawner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `agentx-eng-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

/** Deterministic fake spawner — records every call and returns scripted responses per typeId. */
class FakeSpawner implements SubAgentSpawner {
  calls: Array<{ instruction: string; tools: string[]; typeId: string }> = [];
  constructor(private readonly responses: Record<string, (callCount: number) => { success: boolean; output: string }>) {}

  async spawnAndWait(instruction: string, tools: string[], typeId: string) {
    this.calls.push({ instruction, tools, typeId });
    const responder = this.responses[typeId];
    if (!responder) return { success: false, output: `no fake response configured for ${typeId}` };
    const count = this.calls.filter((c) => c.typeId === typeId).length;
    return responder(count);
  }
}

function npmProject(cwd: string, testScript: string): void {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'echo built', test: testScript } }));
}

// ─── SOP Document fixtures ───
const fakePrd: PrdDocument = {
  originalRequirement: 'Build a simple project',
  productName: 'TestProject',
  features: [{ name: 'Core', description: 'Basic functionality', priority: 'high' }],
  constraints: [],
  rawOutput: '{}',
};

const fakeDesign: DesignDocument = {
  prdRef: 'Build a simple project',
  architecture: 'Simple single-module architecture',
  components: [{ name: 'Main', description: 'Main module', responsibilities: ['Implement core logic'], interfaces: ['function main()'] }],
  dataModels: [],
  techStack: ['Node.js'],
  constraints: [],
  rawOutput: '{}',
};

const fakeTaskList: TaskList = {
  designRef: '{}',
  tasks: [{
    id: 'task-1',
    title: 'Set up project',
    description: 'Create the project structure',
    dependsOn: [],
    acceptanceCriteria: ['npm test passes'],
    unknowns: [],
    status: 'pending',
    retryCount: 0,
  }],
  rawOutput: '{}',
};

describe('CrewEnvironment — pub/sub routing', () => {
  it('delivers messages only to roles watching the matching topic', () => {
    const env = new CrewEnvironment();
    const pm = new ProductManagerRole({ spawnAndWait: async () => ({ success: true, output: '{}' }) });
    env.hire(pm);
    expect(env.getRole('ProductManager')).toBe(pm);
    expect(env.isIdle).toBe(true);

    // ProductManager watches 'user_requirement', not 'design_ready'
    env.publish(broadcastMessage('design_ready', 'Architect', 'design ready'));
    expect(env.isIdle).toBe(true);
  });

  it('delivers a matching-topic broadcast to a watching role and marks it non-idle', () => {
    const env = new CrewEnvironment();
    const pm = new ProductManagerRole({ spawnAndWait: async () => ({ success: true, output: '{}' }) });
    env.hire(pm);

    env.publish(broadcastMessage('user_requirement', 'user', 'build something'));
    expect(env.isIdle).toBe(false);
  });
});

describe('EngineeringCrew — full SOP pipeline', () => {
  it('runs ProductManager → Architect → ProjectManager → Engineer → QaEngineer → Reviewer to success', async () => {
    npmProject(tmpDir, 'exit 0');

    const spawner = new FakeSpawner({
      product_manager: () => ({ success: true, output: JSON.stringify({ productName: 'Test', features: [{ name: 'Core', description: 'Core', priority: 'high' }], constraints: [] }) }),
      architect: () => ({ success: true, output: JSON.stringify({ architecture: 'simple', components: [{ name: 'Main', description: 'main', responsibilities: ['impl'], interfaces: ['main()'] }], dataModels: [], techStack: ['Node.js'], constraints: [] }) }),
      project_manager: () => ({ success: true, output: JSON.stringify({ tasks: [{ id: 'task-1', title: 'Setup', description: 'setup', dependsOn: [], acceptanceCriteria: ['npm test passes'], unknowns: [] }] }) }),
      engineer: () => ({ success: true, output: 'console.log("hello");' }),
      qa_engineer: () => ({ success: true, output: 'test passes' }),
      verifier: () => ({ success: true, output: 'PASS: npm test passes — tests passed' }),
      reviewer: () => ({ success: true, output: 'PASSED: yes\nSUMMARY: All files verified, build and tests pass.\nEVIDENCE: npm test → exit 0' }),
    });

    const crew = new EngineeringCrew(spawner, tmpDir, 'sop-success');
    crew.kickoff('Create a simple project');
    const result = await crew.run(20, 60_000);

    expect(result.success).toBe(true);
    expect(spawner.calls.some((c) => c.typeId === 'product_manager')).toBe(true);
    expect(spawner.calls.some((c) => c.typeId === 'architect')).toBe(true);
    expect(spawner.calls.some((c) => c.typeId === 'project_manager')).toBe(true);
    expect(spawner.calls.some((c) => c.typeId === 'engineer')).toBe(true);
  }, 60_000);

  it('escalates when the ProductManager fails to produce a PRD', async () => {
    const spawner = new FakeSpawner({
      product_manager: () => ({ success: false, output: 'I cannot produce a PRD.' }),
    });

    const crew = new EngineeringCrew(spawner, tmpDir, 'sop-pm-fail');
    crew.kickoff('An impossible request');
    const result = await crew.run(5, 15_000);

    expect(result.success).toBe(false);
    // Architect should NOT have been called
    expect(spawner.calls.some((c) => c.typeId === 'architect')).toBe(false);
  }, 30_000);

  it('does not call the Engineer when a task has an unresolved unknown', async () => {
    npmProject(tmpDir, 'exit 0');

    const spawner = new FakeSpawner({
      product_manager: () => ({ success: true, output: JSON.stringify({ productName: 'Test', features: [{ name: 'X', description: 'X', priority: 'high' }], constraints: [] }) }),
      architect: () => ({ success: true, output: JSON.stringify({ architecture: 'simple', components: [{ name: 'C', description: 'c', responsibilities: ['r'], interfaces: ['i'] }], dataModels: [], techStack: [], constraints: [] }) }),
      project_manager: () => ({
        success: true,
        output: JSON.stringify({
          tasks: [{
            id: 'task-1', title: 'Blocked', description: 'blocked task',
            dependsOn: [], acceptanceCriteria: ['n/a'],
            unknowns: [{ question: 'Does the required library exist?' }],
          }],
        }),
      }),
      engineer: () => ({ success: true, output: 'should never be called' }),
    });

    const crew = new EngineeringCrew(spawner, tmpDir, 'sop-unknown');
    crew.kickoff('A task with an unknown');
    const result = await crew.run(10, 15_000);

    expect(spawner.calls.some((c) => c.typeId === 'engineer')).toBe(false);
    expect(result.success).toBe(false);
  }, 30_000);
});

describe('ReviewerRole', () => {
  it('reports success only when every task is verified', async () => {
    const reviewer = new ReviewerRole();
    const env = new CrewEnvironment();
    env.hire(reviewer);

    const taskList: TaskList = {
      designRef: '',
      tasks: [
        { id: 't1', title: 'a', description: '', dependsOn: [], acceptanceCriteria: [], unknowns: [], status: 'verified', retryCount: 0 },
        { id: 't2', title: 'b', description: '', dependsOn: [], acceptanceCriteria: [], unknowns: [], status: 'in_progress', retryCount: 0 },
      ],
      rawOutput: '',
    };

    // #5: Publish a task_list_ready message so the Reviewer can find the latest
    // task list from the environment's message history.
    env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'task list ready', taskList));
    env.publish(broadcastMessage('phase_verified', 'QaEngineer', 't1 verified', taskList));
    await env.runRound();
    expect(env.messagesByTopic('crew_complete').length).toBe(0);

    taskList.tasks[1]!.status = 'verified';
    // Re-publish the task list with updated status so the Reviewer sees the latest
    env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'task list updated', taskList));
    env.publish(broadcastMessage('phase_verified', 'QaEngineer', 't2 verified', taskList));
    await env.runRound();
    const complete = env.messagesByTopic('crew_complete');
    expect(complete.length).toBe(1);
    expect((complete[0]!.artifact as { success: boolean }).success).toBe(true);
  });
});

describe('ProjectRepo', () => {
  it('tracks source and test files with change state', async () => {
    const { ProjectRepo } = await import('../../src/engineering-crew/ProjectRepo.js');
    const repo = new ProjectRepo(tmpDir);

    await repo.saveSrc('main.js', 'console.log("hello");');
    await repo.saveTest('test_main.js', 'assert(true);');

    expect(repo.getSrcFiles().length).toBe(1);
    expect(repo.getTestFiles().length).toBe(1);
    expect(repo.getChangedSrcFiles().length).toBe(1);

    repo.markAllUnchanged();
    expect(repo.getChangedSrcFiles().length).toBe(0);
  });

  it('scans existing files in incremental mode', async () => {
    const { ProjectRepo } = await import('../../src/engineering-crew/ProjectRepo.js');
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'index.js'), 'console.log("hi");');
    writeFileSync(join(tmpDir, 'src', 'utils.js'), 'export const x = 1;');

    const repo = new ProjectRepo(tmpDir);
    const files = repo.scanExistingFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.includes('index.js'))).toBe(true);
  });
});

describe('CrewMemory', () => {
  it('stores and retrieves messages, filters by topic', async () => {
    const { CrewMemory } = await import('../../src/engineering-crew/types.js');
    const mem = new CrewMemory();
    const msg1 = broadcastMessage('user_requirement', 'user', 'hello');
    const msg2 = broadcastMessage('prd_ready', 'PM', 'prd done');

    mem.add(msg1);
    mem.add(msg2);

    expect(mem.size).toBe(2);
    expect(mem.get().length).toBe(2);
    expect(mem.getByActions(new Set(['user_requirement'])).length).toBe(1);
    expect(mem.getByActions(new Set(['prd_ready'])).length).toBe(1);
  });
});

describe('Individual roles', () => {
  it('ProductManagerRole produces a PRD from user_requirement', async () => {
    const spawner = new FakeSpawner({
      product_manager: () => ({ success: true, output: JSON.stringify({ productName: 'Test', features: [{ name: 'F', description: 'D', priority: 'high' }], constraints: [] }) }),
    });
    const pm = new ProductManagerRole(spawner);
    const env = new CrewEnvironment();
    env.hire(pm);

    env.publish(broadcastMessage('user_requirement', 'user', 'Build a test app'));
    await env.runRound();

    const prdMsgs = env.messagesByTopic('prd_ready');
    expect(prdMsgs.length).toBe(1);
    const prd = prdMsgs[0]!.artifact as PrdDocument;
    expect(prd.productName).toBe('Test');
    expect(prd.features.length).toBe(1);
  });

  it('ArchitectRole produces a design from prd_ready', async () => {
    const spawner = new FakeSpawner({
      architect: () => ({ success: true, output: JSON.stringify({ architecture: 'simple', components: [{ name: 'C', description: 'c', responsibilities: ['r'], interfaces: ['i'] }], dataModels: [], techStack: ['Node'], constraints: [] }) }),
    });
    const architect = new ArchitectRole(spawner, 'test-1');
    const env = new CrewEnvironment();
    env.hire(architect);

    env.publish(broadcastMessage('prd_ready', 'PM', 'prd ready', fakePrd));
    await env.runRound();

    const designMsgs = env.messagesByTopic('design_ready');
    expect(designMsgs.length).toBe(1);
    const design = designMsgs[0]!.artifact as DesignDocument;
    expect(design.components.length).toBe(1);
  });

  it('ProjectManagerRole produces a task list from design_ready', async () => {
    const spawner = new FakeSpawner({
      project_manager: () => ({ success: true, output: JSON.stringify({ tasks: [{ id: 't1', title: 'T', description: 'd', dependsOn: [], acceptanceCriteria: ['test passes'], unknowns: [] }] }) }),
    });
    const pm = new ProjectManagerRole(spawner);
    const env = new CrewEnvironment();
    env.hire(pm);

    env.publish(broadcastMessage('design_ready', 'Architect', 'design ready', fakeDesign));
    await env.runRound();

    const taskMsgs = env.messagesByTopic('task_list_ready');
    expect(taskMsgs.length).toBe(1);
    const taskList = taskMsgs[0]!.artifact as TaskList;
    expect(taskList.tasks.length).toBe(1);
  });
});
