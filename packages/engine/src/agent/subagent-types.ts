export interface SubAgentType {
  id: string;
  name: string;
  defaultTools: string[];
  deniedTools: string[];
  modelPreference?: string;
  description: string;
}

export const SUBAGENT_TYPES: SubAgentType[] = [
  {
    id: 'explorer',
    name: 'Explorer',
    defaultTools: ['file_read', 'folder_list', 'file_find', 'code_search', 'code_grep', 'code_references'],
    deniedTools: ['file_write', 'file_delete', 'shell_exec'],
    description: 'Read-only exploration and code analysis',
  },
  {
    id: 'researcher',
    name: 'Researcher',
    defaultTools: ['deep_web_search', 'web_search', 'web_scrape', 'web_fetch', 'file_read'],
    deniedTools: ['file_write', 'file_delete', 'shell_exec'],
    description: 'Web research and information gathering',
  },
  {
    id: 'executor',
    name: 'Executor',
    defaultTools: [],
    deniedTools: [],
    description: 'Full tool access for task execution',
  },
  // ── Engineering Crew roles (packages/engine/src/engineering-crew/) ──
  // See docs/engineering-crew/DESIGN.md Section 0: these are isolated from the persona
  // CrewManager/"Crew Hub" — they exist purely as SubAgentManager execution profiles for the
  // Engineering Crew's SOP pipeline roles.
  {
    id: 'product_manager',
    name: 'Product Manager',
    defaultTools: ['file_read', 'folder_tree', 'code_search', 'web_search', 'web_fetch'],
    deniedTools: ['file_write', 'file_edit', 'file_delete', 'code_replace', 'code_insert', 'shell_exec', 'shell_background'],
    description: 'Produces PRD from user requirements — read-only analysis',
  },
  {
    id: 'architect',
    name: 'Architect',
    defaultTools: ['file_read', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'web_search', 'web_fetch', 'deep_web_search'],
    deniedTools: ['file_write', 'file_edit', 'file_delete', 'code_replace', 'code_insert', 'shell_exec', 'shell_background'],
    description: 'Produces system design from PRD — read-only planning',
  },
  {
    id: 'project_manager',
    name: 'Project Manager',
    defaultTools: ['file_read', 'folder_tree', 'code_search'],
    deniedTools: ['file_write', 'file_edit', 'file_delete', 'code_replace', 'code_insert', 'shell_exec', 'shell_background'],
    description: 'Decomposes design into tasks with dependencies — read-only planning',
  },
  {
    id: 'engineer',
    name: 'Engineer',
    defaultTools: ['file_read', 'file_write', 'file_edit', 'folder_tree', 'folder_list', 'file_find', 'code_search', 'shell_exec', 'web_search'],
    deniedTools: [],
    description: 'Implements code for assigned tasks — full read/write/shell access',
  },
  {
    id: 'coder',
    name: 'Coder (legacy alias)',
    defaultTools: [],
    deniedTools: [],
    description: 'Backward-compatible alias for engineer — full tool access',
  },
  {
    id: 'qa_engineer',
    name: 'QA Engineer',
    defaultTools: ['file_read', 'folder_tree', 'code_search', 'shell_exec'],
    // Deny-listed from ALL write/mutate tools — QA can only read files and run commands.
    // Test files are saved by the QaEngineerRole via ProjectRepo.saveTest(), not by the LLM directly.
    // This structurally prevents QA from writing or editing any file (#6).
    deniedTools: ['file_write', 'file_edit', 'file_delete', 'code_replace', 'code_insert', 'code_range', 'file_patch', 'shell_background', 'git_commit', 'git_push', 'git_reset'],
    description: 'Writes tests (as text output), runs them, debugs failures — cannot write or edit any files directly',
  },
  {
    id: 'verifier',
    name: 'Verifier',
    defaultTools: ['file_read', 'folder_tree', 'code_search', 'shell_exec', 'http_get', 'build_check'],
    // Deny-listed from every write/mutate tool so it structurally cannot "fix" the code it's
    // grading (docs/engineering-crew/DESIGN.md Section 4.4) — it can only report back.
    deniedTools: ['file_write', 'file_edit', 'file_delete', 'code_replace', 'code_insert', 'code_range', 'file_patch', 'shell_background', 'git_commit', 'git_push', 'git_reset'],
    description: 'Independent, outcome-based verification — cannot write or edit any files',
  },
];
