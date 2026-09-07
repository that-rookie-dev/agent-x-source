import { getLogger } from '@agentx/shared';
import { CrewRole } from './CrewRole.js';
import type { EngineeringCrewMessage, TaskList, Task, CodeDocument, CrewTopic } from './types.js';
import { broadcastMessage, hasUnresolvedUnknowns, MAX_PHASE_RETRIES } from './types.js';
import type { SubAgentSpawner } from './SubAgentSpawner.js';
import type { ProjectRepo } from './ProjectRepo.js';

const ENGINEER_TOOLS = ['file_read', 'file_write', 'file_edit', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'shell_exec', 'web_search', 'web_fetch', 'deep_web_search', 'terminal_start', 'terminal_read', 'terminal_send', 'terminal_kill', 'terminal_list', 'log_tail'];

/**
 * Engineer role — mirrors MetaGPT's `Engineer`
 * (repos/metagpt/metagpt/roles/engineer.py).
 *
 * Watches `task_list_ready` (produced by ProjectManager) and `phase_failed` (produced by
 * QaEngineer when verification fails). Implements the three-step Engineer action sequence:
 *
 * 1. **WriteCode** — implement each eligible task's code.
 * 2. **WriteCodeReview** (optional, controlled by `useCodeReview`) — review the written code.
 * 3. **SummarizeCode** — summarize what was written and check IS_PASS.
 *
 * The IS_PASS check (mirrors MetaGPT's `_is_pass`) uses an LLM to determine whether the
 * coding is complete or needs more work. If not passed, the Engineer loops back to WriteCode.
 *
 * Eligible tasks are those whose dependencies are verified, have no unresolved unknowns,
 * and haven't exceeded the retry limit. Multiple independent tasks run in parallel via
 * `Promise.all` (mirroring MetaGPT's `Engineer._act_sp_with_cr` which iterates `code_todos`).
 *
 * SOP pipeline step:
 *   ... → WriteTasks → **WriteCode → WriteCodeReview → SummarizeCode** → WriteTest → ...
 */
export class EngineerRole extends CrewRole {
  readonly name = 'Engineer';
  protected readonly watchedTopics: Set<CrewTopic> = new Set([
    'task_list_ready',
    'phase_failed',
    'phase_verified', // pick up dependent tasks
  ]);

  /** Whether to run code review after writing (mirrors MetaGPT's `Engineer.use_code_review`). */
  private readonly useCodeReview: boolean;

  constructor(
    private readonly spawner: SubAgentSpawner,
    _cwd: string,
    private readonly repo?: ProjectRepo,
    useCodeReview = false,
  ) {
    super();
    this.useCodeReview = useCodeReview;
    void _cwd;
  }

  protected async act(messages: EngineeringCrewMessage[]): Promise<void> {
    // Get the latest task list from memory or from the current message
    const taskListMsg = messages.find((m) => m.causeBy === 'task_list_ready') ??
      this.importantMemory.filter((m) => m.causeBy === 'task_list_ready').pop();
    if (!taskListMsg) return;

    const taskList = taskListMsg.artifact as TaskList | undefined;
    if (!taskList) return;

    const eligible = taskList.tasks.filter((task) => this.isEligible(task, taskList));
    if (eligible.length === 0) return;

    // WriteCode + WriteCodeReview for all eligible tasks in parallel
    const codeDocs = await Promise.all(eligible.map((task) => this.writeCode(task, taskList)));
    // Save to repo (only for new files — incremental edits are already on disk)
    for (let i = 0; i < eligible.length; i++) {
      const task = eligible[i]!;
      const codeDoc = codeDocs[i]!;
      task.codeDocument = codeDoc;
      task.status = 'in_progress';
      // #3: writeCode() already handles saving new files and incremental edits.
      // Only save here as a fallback if the file wasn't written during writeCode.
      if (this.repo && task.filename && !codeDoc.content) {
        await this.repo.saveSrc(task.filename, codeDoc.content).catch(() => {});
      }
    }

    // SummarizeCode — check if coding is complete
    for (const task of eligible) {
      await this.summarizeCode(task, taskList);
    }

    // Publish code_summarized for QaEngineer
    this.publish(broadcastMessage(
      'code_summarized',
      this.name,
      `Code written and summarized for ${eligible.length} task(s).`,
      taskList,
    ));
  }

  private isEligible(task: Task, taskList: TaskList): boolean {
    if (task.status === 'verified') return false;
    if (task.status === 'in_progress' && task.codeDocument?.isPass) return false;
    if (hasUnresolvedUnknowns(task)) return false;
    if (!task.dependsOn.every((depId) => taskList.tasks.find((t) => t.id === depId)?.status === 'verified')) return false;
    if ((task.retryCount ?? 0) > MAX_PHASE_RETRIES) return false;
    return true;
  }

  /** WriteCode action — mirrors MetaGPT's `Engineer._act_write_code`.
   *
   * Incremental editing (#7): if the target file already exists in the repo, the
   * instruction includes the current content and asks the LLM to make targeted edits
   * using `file_edit`/`code_replace` tools rather than regenerating the entire file.
   * This is token-efficient and preserves existing code that doesn't need changing.
   */
  private async writeCode(task: Task, taskList: TaskList): Promise<CodeDocument> {
    const isRetry = (task.retryCount ?? 0) > 0;
    getLogger().info('ENGINEERING_CREW', `Engineer writing code for task "${task.title}" (${task.id})${isRetry ? ' [retry]' : ''}`);

    // Check if the file already exists (incremental mode)
    const filename = task.filename ?? `task-${task.id}.js`;
    const existingFile = this.repo ? await this.repo.getSrc(filename) : undefined;
    const isIncremental = !!existingFile;

    const instruction = buildWriteCodeInstruction(task, taskList, isRetry, existingFile?.content);
    const result = await this.spawner.spawnAndWait(instruction, ENGINEER_TOOLS, 'engineer', 900_000);

    // #3: In incremental mode, the LLM uses file_edit/code_replace tools to make surgical
    // edits directly on disk. result.output is the LLM's summary text, NOT the file content.
    // We must read the actual file content back from disk to avoid overwriting the edits.
    let fileContent: string;
    if (isIncremental && this.repo) {
      const updatedFile = await this.repo.getSrc(filename);
      fileContent = updatedFile?.content ?? result.output;
    } else {
      fileContent = result.output;
    }

    const codeDoc: CodeDocument = {
      filename,
      content: fileContent,
      language: detectLanguage(filename),
      reviewed: false,
      isPass: false,
    };

    // For new files, save the content to disk via the repo abstraction
    if (!isIncremental && this.repo && task.filename) {
      await this.repo.saveSrc(filename, fileContent).catch(() => {});
    }
    // For incremental edits, the file was already modified in-place by the sub-agent's tools

    // WriteCodeReview (optional) — mirrors MetaGPT's `Engineer._act_sp_with_cr(review=True)`
    if (this.useCodeReview) {
      const reviewResult = await this.spawner.spawnAndWait(
        buildCodeReviewInstruction(task, codeDoc),
        ENGINEER_TOOLS,
        'engineer',
        300_000,
      );
      codeDoc.reviewed = true;
      codeDoc.reviewNotes = reviewResult.output.slice(0, 2000);
      // If review produced improved code, use it
      if (reviewResult.success && reviewResult.output.length > codeDoc.content.length) {
        codeDoc.content = reviewResult.output;
      }
    }

    task.implementationNotes = result.output.slice(0, 4000);
    if (isIncremental) {
      getLogger().info('ENGINEERING_CREW', `Engineer used incremental editing for existing file "${filename}"`);
    }
    return codeDoc;
  }

  /** SummarizeCode + IS_PASS check — mirrors MetaGPT's `Engineer._act_summarize` + `_is_pass`. */
  private async summarizeCode(task: Task, _taskList: TaskList): Promise<void> {
    if (!task.codeDocument) return;

    getLogger().info('ENGINEERING_CREW', `Engineer summarizing code for task "${task.title}" (${task.id})`);

    const summaryResult = await this.spawner.spawnAndWait(
      buildSummarizeInstruction(task),
      ENGINEER_TOOLS,
      'engineer',
      300_000,
    );

    task.codeDocument.summary = summaryResult.output.slice(0, 2000);

    // IS_PASS check — mirrors MetaGPT's `_is_pass` which asks LLM if anything else needs doing
    const isPassResult = await this.spawner.spawnAndWait(
      buildIsPassInstruction(task.codeDocument.summary),
      [],
      'engineer',
      60_000,
    );

    const isPass = isPassResult.output.toUpperCase().includes('YES');
    task.codeDocument.isPass = isPass;
    task.codeDocument.passReason = isPassResult.output.slice(0, 500);

    getLogger().info('ENGINEERING_CREW', `Engineer IS_PASS for task "${task.title}": ${isPass ? 'YES' : 'NO'}`);
  }
}

function buildWriteCodeInstruction(task: Task, taskList: TaskList, isRetry: boolean, existingContent?: string): string {
  const criteria = task.acceptanceCriteria.map((c) => `- ${c}`).join('\n') || '(no specific criteria — use judgment)';
  const priorFeedback = isRetry && task.verification
    ? `\n\nThe previous attempt FAILED verification:\n${task.verification.filter((v) => !v.passed).map((v) => `- ${v.criterion}: ${v.detail}`).join('\n')}\n\nFix these specific issues. Do not repeat the same mistake.`
    : '';
  const rootCauseNotes = isRetry && task.implementationNotes
    ? `\n\n## ROOT CAUSE ANALYSIS FROM QA\n${task.implementationNotes}\n\nApply this fix. Do NOT repeat the same mistake that caused the previous failure.`
    : '';
  const deps = task.dependsOn.length > 0
    ? `\n\nThis task depends on: ${task.dependsOn.join(', ')}. Those tasks are already verified.`
    : '';
  const unknowns = task.unknowns.length > 0
    ? `\n\n## UNKNOWNS TO RESOLVE BEFORE IMPLEMENTING\nThis task has open unknowns that you MUST research and resolve before writing code:\n${task.unknowns.map((u) => `- ${u.question}`).join('\n')}\n\nUse web_search, web_fetch, or deep_web_search to research each unknown. Only start coding once you have a clear answer.`
    : '';

  // #7: Incremental editing — if the file already exists, include current content
  // and ask for targeted edits rather than full file regeneration.
  const incrementalSection = existingContent
    ? `\n\n## EXISTING FILE CONTENT (incremental mode)\nThe file "${task.filename}" already exists. Here is the current content:\n"""\n${existingContent.slice(0, 8000)}\n"""\n\nIMPORTANT: Use the file_edit and code_replace tools to make SURGICAL edits to this existing file. Do NOT regenerate the entire file. Only change what needs to change to meet the acceptance criteria. Preserve all existing code that is correct.`
    : '';

  return `You are the Engineer on a software engineering team, implementing one task of a larger plan.

Overall objective: ${taskList.designRef.slice(0, 200)}

Your task: "${task.title}"
Description: ${task.description}

Acceptance criteria — implement exactly this, verifiably:
${criteria}
${priorFeedback}${rootCauseNotes}${unknowns}${deps}${incrementalSection}

Rules:
- Implement real, working code — not a stub, placeholder, or fallback that merely compiles.
- If a required external dependency genuinely does not support what's needed, say so explicitly rather than silently substituting a stub.
- Run the appropriate build/test commands yourself and confirm they pass before finishing.

MANDATORY VERIFICATION (do NOT skip these steps):
1. After writing code, run the build command (e.g. shell_exec "npm run build" or "mvn -B compile").
2. If the build fails, READ the error output, FIX the code, and rebuild. Repeat until it passes.
3. If the task involves a server/API endpoint:
   a. Start the server using terminal_start (NOT shell_background — you need to read the output).
   b. Wait 2-3 seconds, then use terminal_read to check the server started successfully.
   c. If the server crashed or logged errors, READ the logs with terminal_read, diagnose the issue, fix the code, rebuild, and restart.
   d. Send an actual HTTP request to the endpoint using shell_exec (e.g. shell_exec "curl -s http://localhost:PORT/endpoint").
   e. Verify the response is valid and not a stub/fallback/placeholder.
   f. Kill the terminal with terminal_kill when done.
4. If the task involves tests, run them with shell_exec and confirm they pass.
5. If you encounter a runtime error you don't understand, use web_search to research the error message and find the root cause + fix.
6. Do NOT claim the task is complete until you have verified it works end-to-end.

NEVER claim success without proof. "It compiles" is NOT proof. "The process started" is NOT proof. Only a successful build + test + runtime check is proof.

End your response with the complete source code file content and a concise summary of what you implemented and how you verified it works.`;
}

function buildCodeReviewInstruction(task: Task, codeDoc: CodeDocument): string {
  return `You are reviewing code written for the task "${task.title}".

Acceptance criteria:
${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

Code to review:
"""
${codeDoc.content.slice(0, 4000)}
"""

Review the code for:
1. Correctness — does it meet the acceptance criteria?
2. Code quality — is it clean, readable, and maintainable?
3. Edge cases — are error paths handled?
4. Security — are there any obvious vulnerabilities?

If the code needs improvements, provide the improved version. If it's good, say "APPROVED" and include the original code.`;
}

function buildSummarizeInstruction(task: Task): string {
  return `Summarize the code that was written for task "${task.title}".

Code:
"""
${task.codeDocument?.content.slice(0, 3000) ?? '(no code)'}
"""

Provide a concise summary of:
1. What was implemented
2. How to verify it (exact command to run or request to send)
3. Any known issues or limitations`;
}

function buildIsPassInstruction(summary: string): string {
  return `${summary}

----
Does the above indicate that the coding task is complete and nothing else needs to be done?
If there are any tasks to be completed, answer 'NO' along with the to-do list.
Otherwise, answer 'YES'.

Answer strictly YES or NO (with a one-line reason).`;
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript';
    case 'js': case 'jsx': return 'javascript';
    case 'py': return 'python';
    case 'java': return 'java';
    case 'kt': return 'kotlin';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'rb': return 'ruby';
    case 'php': return 'php';
    case 'c': case 'cpp': case 'cc': return 'cpp';
    case 'cs': return 'csharp';
    case 'swift': return 'swift';
    case 'sql': return 'sql';
    case 'sh': case 'bash': return 'bash';
    default: return 'text';
  }
}
