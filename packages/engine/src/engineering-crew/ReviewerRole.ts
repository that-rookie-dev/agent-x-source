import { CrewRole } from './CrewRole.js';
import type { EngineeringCrewMessage, TaskList, CrewTopic } from './types.js';
import { broadcastMessage } from './types.js';
import { getLogger } from '@agentx/shared';
import type { SubAgentSpawner } from './SubAgentSpawner.js';

const REVIEWER_TOOLS = ['file_read', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'shell_exec', 'terminal_start', 'terminal_read', 'terminal_kill', 'web_search'];

/**
 * Final gate before the Engineering Crew reports "done" to the user — mirrors MetaGPT's
 * final review step.
 *
 * Watches `phase_verified`, `phase_failed`, and `unknown_escalated`. When all tasks are
 * verified, performs a FINAL INTEGRATION CHECK:
 * 1. Deterministic: all tasks verified (existing behavior).
 * 2. LLM-based: independent review of the complete deliverable — does the whole system
 *    work end-to-end? Are acceptance criteria met? Is there any stub/placeholder code?
 * 3. Runtime: if the project has a runnable entry point, start it and test it.
 *
 * Only after all three checks pass does it publish `crew_complete` with success.
 * If any check fails, it publishes `phase_failed` with specific issues for the Engineer.
 *
 * Stale-message protection (#5): the Reviewer always reads the **latest** `task_list_ready`
 * from its own memory to ensure it sees the most recent task statuses.
 */
export class ReviewerRole extends CrewRole {
  readonly name = 'Reviewer';
  protected readonly watchedTopics: Set<CrewTopic> = new Set(['phase_verified', 'phase_failed', 'unknown_escalated']);

  constructor(private readonly spawner?: SubAgentSpawner, _cwd?: string) {
    super();
    void _cwd;
  }

  protected async act(messages: EngineeringCrewMessage[]): Promise<void> {
    const latest = messages[messages.length - 1]!;

    if (latest.causeBy === 'unknown_escalated') {
      this.publish(broadcastMessage(
        'crew_complete',
        this.name,
        `Blocked — needs human input: ${latest.content}`,
        { success: false, blocked: true },
      ));
      return;
    }

    // #5: Always read the latest task list from memory
    const taskList = this.getLatestTaskList();
    if (!taskList) return;

    const allVerified = taskList.tasks.length > 0 && taskList.tasks.every((t) => t.status === 'verified');
    if (!allVerified) {
      // Not all tasks verified yet — remain idle; more messages will arrive.
      return;
    }

    // ─── FINAL INTEGRATION CHECK ───
    // All individual tasks are verified, but does the WHOLE system work end-to-end?
    getLogger().info('ENGINEERING_CREW', `Reviewer: all ${taskList.tasks.length} tasks verified — running final integration check`);

    const integrationResult = await this.runFinalIntegrationCheck(taskList);
    if (!integrationResult.passed) {
      getLogger().warn('ENGINEERING_CREW', `Reviewer: final integration check FAILED: ${integrationResult.summary}`);
      // Send specific issues back to the Engineer
      for (const task of taskList.tasks) {
        task.status = 'failed';
        task.retryCount = (task.retryCount ?? 0) + 1;
        task.implementationNotes = `FINAL REVIEW FEEDBACK:\n${integrationResult.summary}`;
      }
      this.publish(broadcastMessage(
        'phase_failed',
        this.name,
        `Final integration check failed:\n${integrationResult.summary}`,
        taskList,
      ));
      return;
    }

    getLogger().info('ENGINEERING_CREW', `Reviewer: final integration check PASSED — crew complete`);
    this.publish(broadcastMessage(
      'crew_complete',
      this.name,
      `All ${taskList.tasks.length} task(s) verified AND final integration check passed.\n\nDelivery report:\n${integrationResult.summary}`,
      { success: true, deliveryReport: integrationResult.summary },
    ));
  }

  /**
   * Final integration check — an independent LLM sub-agent reviews the complete
   * deliverable end-to-end. This catches issues that per-task verification misses:
   * - Integration bugs between components
   * - Missing files or configurations
   * - Stub/placeholder code that slipped through
   * - End-to-end workflow failures
   */
  private async runFinalIntegrationCheck(taskList: TaskList): Promise<{ passed: boolean; summary: string }> {
    if (!this.spawner) {
      // No spawner available — fall back to deterministic-only check (all verified)
      return { passed: true, summary: `All ${taskList.tasks.length} tasks verified.` };
    }

    const fileList = taskList.tasks
      .map((t) => `- ${t.filename ?? t.id}: ${t.title} (status: ${t.status})`)
      .join('\n');
    const criteria = taskList.tasks
      .flatMap((t) => t.acceptanceCriteria.map((c) => `- [${t.id}] ${c}`))
      .join('\n');

    const instruction = `You are the Reviewer performing a FINAL INTEGRATION CHECK on a software engineering project.
All individual tasks have been verified by QA, but you must verify the COMPLETE system works end-to-end.

Project files:
${fileList}

Acceptance criteria across all tasks:
${criteria}

Perform these checks:
1. Use folder_tree and file_read to inspect ALL files in the project. Verify they are complete, not stubs, and work together.
2. Use shell_exec to run the full build (e.g. "mvn -B clean compile" or "npm run build"). It must pass.
3. Use shell_exec to run the full test suite (e.g. "mvn -B test" or "npm test"). It must pass.
4. If the project has a runnable entry point (server, CLI, etc.):
   a. Start it with terminal_start.
   b. Wait 3 seconds, then use terminal_read to verify it started.
   c. Send an actual request with shell_exec (e.g. "curl -s http://localhost:PORT/endpoint").
   d. Verify the response is valid and not a stub/placeholder.
   e. Kill the terminal with terminal_kill.
5. Check for any stub, placeholder, "not implemented", or fallback code that shouldn't be in a production deliverable.
6. Verify all acceptance criteria are met by the actual running system.

Respond in this format:
PASSED: <yes|no>
SUMMARY: <detailed delivery report including what was verified, how it was verified, and any issues found>
EVIDENCE: <specific commands run and their results>`;

    try {
      const result = await this.spawner.spawnAndWait(instruction, REVIEWER_TOOLS, 'reviewer', 600_000);
      const text = result.output.trim();
      const passed = /^PASSED:\s*yes/im.test(text);
      const summaryMatch = text.match(/SUMMARY:\s*(.*?)(?:\nEVIDENCE:|$)/is);
      const summary = summaryMatch ? summaryMatch[1]!.trim() : text.slice(0, 2000);
      return { passed, summary };
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW', `Final integration check failed: ${(e as Error).message}`);
      return { passed: false, summary: `Integration check error: ${(e as Error).message}` };
    }
  }

  /**
   * Get the latest TaskList from the environment's message history.
   */
  private getLatestTaskList(): TaskList | undefined {
    if (!this.environment) return undefined;
    const taskListMsgs = this.environment.messagesByTopic('task_list_ready');
    const latest = taskListMsgs[taskListMsgs.length - 1];
    return latest?.artifact as TaskList | undefined;
  }
}
