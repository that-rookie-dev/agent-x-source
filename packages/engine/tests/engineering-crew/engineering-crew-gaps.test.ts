import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineeringCrew } from '../../src/engineering-crew/EngineeringCrew.js';
import { EngineeringCrewStore } from '../../src/engineering-crew/EngineeringCrewStore.js';
import { CrewEnvironment } from '../../src/engineering-crew/CrewEnvironment.js';
import { ProductManagerRole } from '../../src/engineering-crew/ProductManagerRole.js';
import { ProjectManagerRole } from '../../src/engineering-crew/ProjectManagerRole.js';
import { EngineerRole } from '../../src/engineering-crew/EngineerRole.js';
import { ReviewerRole } from '../../src/engineering-crew/ReviewerRole.js';
import { QaEngineerRole, runCommandAsync, generateTestFilename } from '../../src/engineering-crew/QaEngineerRole.js';
import { ProjectRepo } from '../../src/engineering-crew/ProjectRepo.js';
import { ContextAwareSpawner } from '../../src/engineering-crew/SubAgentSpawner.js';
import { broadcastMessage } from '../../src/engineering-crew/types.js';
import type { TaskList, PlanArtifact, CodeDocument, Task } from '../../src/engineering-crew/types.js';
import { routeCodingTask } from '../../src/engineering-crew/CodingTaskRouter.js';
import { detectAdaptersForProject } from '../../src/agent/ToolchainAdapters.js';

function createFakeSpawner(output: string, tokenUsage?: { input: number; output: number }) {
  return {
    spawnAndWait: async () => ({ success: true, output, tokenUsage }),
  };
}

function createControlledSpawner(outputs: string[], tokenUsage?: { input: number; output: number }) {
  let index = 0;
  return {
    spawnAndWait: async () => {
      const out = outputs[index % outputs.length]!;
      index++;
      return { success: true, output: out, tokenUsage };
    },
  };
}

describe('Engineering Crew gap fixes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'eng-crew-gaps-'));
  });

  // ─── Fix #1: Budget enforcement ───
  it('stops the crew when the budget is exceeded', async () => {
    // Publish a valid task list so Engineer has work to do
    const taskList: TaskList = {
      designRef: 'Build a tiny thing',
      tasks: [{
        id: 't1', title: 'Tiny', description: 'do it',
        dependsOn: [], acceptanceCriteria: ['it works'], unknowns: [],
        status: 'pending', retryCount: 0, filename: 'tiny.js',
      }],
      rawOutput: '',
    };
    // Each spawn returns content and 30M input tokens (~$90) — budget of $1 will be exceeded immediately
    const inner = { spawnAndWait: async () => ({ success: true, output: 'yes', tokenUsage: { input: 10_000_000, output: 0 } }) };
    const spawner = new ContextAwareSpawner(inner as any);
    const crew = new EngineeringCrew(spawner, tmpDir, 'budget-test', { maxBudget: 1 });
    (crew as any).env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', taskList));

    const result = await crew.run(2, 60_000);
    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/budget/i);
    expect(result.cost).toBeDefined();
    expect(result.cost!.estimatedCost).toBeGreaterThan(0);
  });

  // ─── Fix #2: DB checkpointing per round ───
  it('saves a checkpoint after each round', async () => {
    const saveCalls: number[] = [];
    const fakeStore = {
      saveRun: async (plan: any, sessionId?: string) => { saveCalls.push(Date.now()); },
      loadRun: async () => null,
      listRuns: async () => [],
      findIncompleteRunBySession: async () => null,
      findLatestRunBySession: async () => null,
    } as unknown as EngineeringCrewStore;

    const spawner = createFakeSpawner('yes');
    const crew = new EngineeringCrew(spawner, tmpDir, 'checkpoint-test');
    crew.setStore(fakeStore);
    // Publish a task list so buildPlanArtifact has something to save
    const taskList: TaskList = { designRef: '', tasks: [], rawOutput: '' };
    (crew as any).env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', taskList));
    // checkpoint() is awaited now, so saveRun should have been called
    await (crew as any).checkpoint();
    expect(saveCalls.length).toBe(1);
  });

  // ─── Fix #3: Incremental editing preserves existing files ───
  it('preserves existing file content in incremental mode', async () => {
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'util.js'), 'function existingHelper() { return 42; }\n');

    const repo = new ProjectRepo(tmpDir);
    const spawner = {
      spawnAndWait: async () => {
        // Simulate the LLM editing the file on disk (via tools)
        writeFileSync(join(srcDir, 'util.js'), 'function existingHelper() { return 42; }\nfunction newFeature() { return 1; }\n');
        return { success: true, output: 'Added newFeature to util.js' };
      },
    };
    const engineer = new EngineerRole(spawner as any, tmpDir, repo, false);

    const task: Task = {
      id: 't1', title: 'Add newFeature', description: '',
      dependsOn: [], acceptanceCriteria: ['util.js has newFeature'], unknowns: [],
      status: 'pending', retryCount: 0, filename: 'util.js',
    };
    const taskList: TaskList = {
      designRef: '',
      tasks: [task],
      rawOutput: '',
    };

    const codeDoc = await (engineer as any).writeCode(task, taskList);
    expect(codeDoc.content).toContain('existingHelper');
    expect(codeDoc.content).toContain('newFeature');
  });

  // ─── Fix #4: Resume does not re-trigger ProductManager ───
  it('ProductManager does not regenerate PRD if one exists in environment', async () => {
    let spawnCalls = 0;
    const spawner = { spawnAndWait: async () => { spawnCalls++; return { success: true, output: '{"productName":"ShouldNot","features":[{"name":"f","description":"d","priority":"high"}],"constraints":[]}' }; } };
    const pm = new ProductManagerRole(spawner as any);
    const env = new CrewEnvironment();
    env.hire(pm);

    // Seed an existing PRD in the environment (simulates resume republish)
    env.publish(broadcastMessage('prd_ready', 'ProductManager', 'existing prd', {
      originalRequirement: 'Build X', productName: 'Existing', features: [], constraints: [], rawOutput: '',
    }));

    // New user_requirement should NOT trigger a new PRD
    env.publish(broadcastMessage('user_requirement', 'user', 'continue with X'));
    await env.runRound();
    expect(spawnCalls).toBe(0);
  });

  // ─── Fix #5: Cost displayed in result ───
  it('result contains a populated cost field', async () => {
    const usage = { input: 1000, output: 500 };
    const spawner = new ContextAwareSpawner(createFakeSpawner('yes', usage));
    const crew = new EngineeringCrew(spawner, tmpDir, 'cost-test');
    crew.kickoff('Build a tiny thing');

    const result = await crew.run(2, 60_000);
    expect(result.cost).toBeDefined();
    expect(result.cost!.totalTokens).toBe(1500);
    expect(result.cost!.estimatedCost).toBeGreaterThan(0);
  });

  // ─── Fix #6: Python adapter ID correctly maps to pytest ───
  it('detects pytest for Python projects', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'python-project-'));
    writeFileSync(join(projectRoot, 'requirements.txt'), '');
    const adapters = detectAdaptersForProject(projectRoot);
    expect(adapters.some((a) => a.id === 'pytest')).toBe(true);
  });

  // ─── Fix #7: runCommand is async (does not block event loop) ───
  it('runCommandAsync returns a Promise', async () => {
    writeFileSync(join(tmpDir, 'script.sh'), 'echo hello');
    const result = await runCommandAsync('sh script.sh', tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/hello/i);
  });

  // ─── Fix #8: writeTest uses language-aware test filenames ───
  it('generates language-appropriate test filenames', () => {
    expect(generateTestFilename('src/util.py', 'python')).toBe('tests/test_util.py');
    expect(generateTestFilename('src/Util.java', 'java')).toBe('src/test/java/UtilTest.java');
    expect(generateTestFilename('src/main.go', 'go')).toBe('src/main_test.go');
    expect(generateTestFilename('src/app.ts', 'typescript')).toBe('tests/app.test.ts');
  });

  // ─── Fix #9: runRuntimeChecks handles endpoint verification ───
  it('returns failed verification when no server is running (endpoint not reachable)', async () => {
    const qa = new QaEngineerRole(createFakeSpawner('ok') as any, tmpDir, new ProjectRepo(tmpDir));
    const task: Task = {
      id: 't1', title: 'API', description: '', dependsOn: [],
      acceptanceCriteria: ['GET http://127.0.0.1:49999/health returns 200'],
      unknowns: [], status: 'pending', retryCount: 0,
    };
    const outcomes = await (qa as any).runRuntimeChecks(task);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes[0].passed).toBe(false);
  });

  // ─── Fix #10: buildPlanArtifact aggregates acceptance criteria ───
  it('aggregates acceptance criteria from tasks', async () => {
    const spawner = createControlledSpawner(['yes']);
    const crew = new EngineeringCrew(spawner as any, tmpDir, 'criteria-test');
    // Publish a task list with criteria
    const taskList: TaskList = {
      designRef: '',
      tasks: [
        { id: 't1', title: 'A', description: '', dependsOn: [], acceptanceCriteria: ['A works'], unknowns: [], status: 'pending', retryCount: 0 },
        { id: 't2', title: 'B', description: '', dependsOn: [], acceptanceCriteria: ['B works'], unknowns: [], status: 'pending', retryCount: 0 },
      ],
      rawOutput: '',
    };
    (crew as any).env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', taskList));
    const plan = (crew as any).buildPlanArtifact();
    expect(plan.acceptanceCriteria).toContain('A works');
    expect(plan.acceptanceCriteria).toContain('B works');
  });

  // ─── Fix #11: SOURCE_BUG detection attached to implementation notes ───
  it('attaches SOURCE_BUG explanation to task implementationNotes', async () => {
    const spawner = { spawnAndWait: async () => ({ success: true, output: 'SOURCE_BUG: the function is missing a return statement' }) };
    const repo = new ProjectRepo(tmpDir);
    const qa = new QaEngineerRole(spawner as any, tmpDir, repo);
    const task: Task = {
      id: 't1', title: 'test', description: '', dependsOn: [], acceptanceCriteria: [], unknowns: [],
      status: 'in_progress', retryCount: 0,
      codeDocument: { filename: 'foo.js', content: 'function f() {}', language: 'javascript', reviewed: false, isPass: false },
      testDocument: { filename: 'foo.test.js', content: '// test', language: 'javascript', codeFilename: 'foo.js' },
    };
    const debugged = await (qa as any).debugError(task, { testFilename: 'foo.test.js', codeFilename: 'foo.js', output: 'f is undefined', exitCode: 1, passed: false, summary: 'fail' });
    expect(debugged).toBeNull();
    expect(task.implementationNotes).toMatch(/SOURCE_BUG/);
  });

  // ─── Fix #13: checkpoint() awaits DB write ───
  it('checkpoint awaits the DB save before returning', async () => {
    let saveResolved = false;
    const fakeStore = {
      saveRun: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        saveResolved = true;
      },
    } as unknown as EngineeringCrewStore;

    const spawner = createFakeSpawner('yes');
    const crew = new EngineeringCrew(spawner, tmpDir, 'checkpoint-await');
    crew.setStore(fakeStore);
    (crew as any).env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', {
      designRef: '', tasks: [], rawOutput: '',
    } as TaskList));
    await (crew as any).checkpoint();
    expect(saveResolved).toBe(true);
  });

  // ─── Fix #16: Cancellation stops the run loop ───
  it('stops running when cancel() is called', async () => {
    // Publish a valid task list so the crew has work and doesn't complete immediately
    const taskList: TaskList = {
      designRef: 'Build a tiny thing',
      tasks: [{
        id: 't1', title: 'Tiny', description: 'do it',
        dependsOn: [], acceptanceCriteria: ['it works'], unknowns: [],
        status: 'pending', retryCount: 0, filename: 'tiny.js',
      }],
      rawOutput: '',
    };
    // Spawner takes 100ms so cancel can fire while a round is in progress
    const slowSpawner = {
      spawnAndWait: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { success: true, output: 'yes' };
      },
    };
    const crew = new EngineeringCrew(slowSpawner as any, tmpDir, 'cancel-test');
    (crew as any).env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', taskList));

    // Cancel after 50ms while the first round is running
    setTimeout(() => crew.cancel(), 50);

    const result = await crew.run(30, 60_000);
    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/cancelled/i);
  });

  // ─── Fix #17: runRound second pass handles newly-eligible roles ───
  it('runRound processes roles triggered by messages from the same round', async () => {
    const env = new CrewEnvironment();
    const reviewer = new ReviewerRole();
    env.hire(reviewer);

    // Publish a task list then a phase_verified in the same round
    const taskList: TaskList = { designRef: '', tasks: [{ id: 't1', title: 'A', description: '', dependsOn: [], acceptanceCriteria: [], unknowns: [], status: 'verified', retryCount: 0 }], rawOutput: '' };
    env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', taskList));
    env.publish(broadcastMessage('phase_verified', 'QaEngineer', 't1 verified', taskList));

    await env.runRound();
    expect(env.messagesByTopic('crew_complete').length).toBe(1);
  });

  // ─── Fix #18: Cost model accepts configurable rates ───
  it('uses configurable cost rates', async () => {
    const usage = { input: 1_000_000, output: 0 };
    const spawner = new ContextAwareSpawner(createFakeSpawner('yes', usage));
    const crew = new EngineeringCrew(spawner, tmpDir, 'cost-rate-test', {
      costRates: { inputPerMillion: 1, outputPerMillion: 5 },
    });
    crew.kickoff('Build a tiny thing');
    const result = await crew.run(2, 60_000);
    expect(result.cost).toBeDefined();
    expect(result.cost!.estimatedCost).toBe(1); // 1M input * $1/M = $1
  });

  // ─── Fix #19: Progress events include taskId ───
  it('emits progress events with the crew taskId', async () => {
    const events: any[] = [];
    const spawner = createFakeSpawner('yes');
    const crew = new EngineeringCrew(spawner, tmpDir, 'progress-taskid');
    crew.setProgressCallback((event) => events.push(event));
    crew.kickoff('Build a tiny thing');
    await crew.run(2, 60_000);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.taskId === 'progress-taskid')).toBe(true);
  });

  // ─── Fix #20: Context prefix is refreshed each round ───
  it('context prefix changes as crew state updates', async () => {
    const crew = new EngineeringCrew({ spawnAndWait: async () => ({ success: true, output: 'yes' }) } as any, tmpDir, 'refresh-prefix');
    crew.setSessionContext({
      sessionId: 's1',
      conversationHistory: [],
      latestUserMessage: 'Build X',
    });

    const prefix1 = (crew as any).buildContextPrefix();

    // Publish a task list — this is new state that should appear in the refreshed prefix
    const taskList: TaskList = {
      designRef: '',
      tasks: [{ id: 't1', title: 'A', description: '', dependsOn: [], acceptanceCriteria: [], unknowns: [], status: 'pending', retryCount: 0 }],
      rawOutput: '',
    };
    (crew as any).env.publish(broadcastMessage('task_list_ready', 'ProjectManager', 'tasks', taskList));

    const prefix2 = (crew as any).buildContextPrefix();
    expect(prefix2).toContain('Current crew state');
    expect(prefix2).not.toEqual(prefix1);
  });

  // ─── New gap: ProjectRepo rejects traversal and absolute paths ───
  it('ProjectRepo rejects unsafe file paths', async () => {
    const repo = new ProjectRepo(tmpDir);
    await expect(repo.saveSrc('../escape.js', 'x')).rejects.toThrow(/Refusing/);
    await expect(repo.saveSrc('/etc/passwd', 'x')).rejects.toThrow(/Refusing/);
  });

  // ─── New gap: runBuildAndTest stops after build failure ───
  it('stops build/test after build fails', async () => {
    // Set up a project so resolveCommands picks something
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ scripts: { build: 'exit 1', test: 'echo "test ran"' } }));
    const qa = new QaEngineerRole(createFakeSpawner('ok') as any, tmpDir, new ProjectRepo(tmpDir));
    const task: Task = {
      id: 't1', title: 'test', description: '', dependsOn: [], acceptanceCriteria: [], unknowns: [],
      status: 'pending', retryCount: 0,
      codeDocument: { filename: 'util.js', content: '', language: 'javascript', reviewed: false, isPass: false },
      testDocument: { filename: 'util.test.js', content: '', language: 'javascript', codeFilename: 'util.js' },
    };
    const outcomes = await (qa as any).runBuildAndTest(task);
    const buildOutcome = outcomes.find((o: any) => o.criterion === 'build passes');
    const testOutcome = outcomes.find((o: any) => o.criterion === 'test passes');
    expect(buildOutcome?.passed).toBe(false);
    expect(testOutcome).toBeUndefined();
  });

  // ─── Fix #14: routeCodingTask routes with resume context ───
  it('does not resume for non-coding requests even with prior run', async () => {
    const decision = await routeCodingTask('continue the research', {
      primary: 'research', confidence: 0.9,
    }, {
      sessionId: 's1', hasPriorRun: true, hasIncompleteRun: true, priorTaskId: 'prior-1',
    });
    expect(decision.useEngineeringCrew).toBe(false);
  });
});
