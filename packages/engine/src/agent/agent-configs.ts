import type { AgentInfo } from './AgentInfo.js';

export const BUILTIN_AGENTS: AgentInfo[] = [
  {
    id: 'build',
    name: 'Agent',
    mode: 'agent',
    description: 'Full agent mode with all tools available for autonomous execution',
    defaultTools: [],
    deniedTools: [],
    permissions: [],
    prompt: '',
    temperature: 0,
    color: '#4CAF50',
  },
  {
    id: 'plan',
    name: 'Plan',
    mode: 'plan',
    description: 'Plan mode — reads, creation, scripts, search, and scheduling; edits/deletes need Agent mode',
    defaultTools: [],
    deniedTools: [
      'file_delete', 'folder_delete', 'folder_move', 'file_patch',
      'code_replace', 'code_insert', 'code_range', 'json_set',
      'delete_file', 'file_edit', 'apply_patch', 'todo_delete',
      'process_kill', 'package_remove',
      'git_reset', 'git_rebase', 'git_merge', 'git_stash',
      'delegate_to_subagent', 'sub_agent_spawn', 'delegate_to_crew', 'spawn_crew_workers',
    ],
    permissions: [],
    prompt: 'You are in Plan mode. Reads, web search, new file creation, shell/scripts, notifications, and automation scheduling are available.\n\nBLOCKED (require Agent/Hyperdrive): editing or deleting existing files, destructive git ops, and crew orchestration spawns.\n\nCRITICAL:\n- For reminders or scheduled tasks ("at 5pm", "in 10 minutes"): call automation_register FIRST — do NOT web_search now.\n- NEVER call file_edit, code_replace, delete_file, or other edit/delete tools — they WILL be blocked.\n- Do NOT ask users to switch modes for search, scheduling, new files, or scripts.\n- DO ask to switch modes only when they need to edit or delete existing resources.',
    temperature: 0.2,
    color: '#2196F3',
  },
];
