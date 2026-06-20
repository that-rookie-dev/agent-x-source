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
    description: 'Plan mode — analyzes tasks and creates plans without executing write tools',
    defaultTools: [],
    deniedTools: [
      'file_write', 'file_delete', 'folder_create', 'folder_delete', 'folder_move', 'file_copy',
      'file_patch', 'code_replace', 'code_insert', 'code_range',
      'csv_create', 'pdf_create', 'docx_create', 'pptx_create', 'xlsx_create',
      'json_set', 'http_download', 'archive_create', 'archive_extract',
      'browser_screenshot', 'chart_generate', 'qr_generate',
      'shell_exec', 'shell_background', 'shell_exec_streaming',
      'process_kill', 'db_query', 'db_migrate',
      'git_commit', 'git_push', 'git_merge', 'git_rebase', 'git_reset', 'git_tag', 'git_stash',
      'package_install', 'package_remove', 'pkg_update',
      'cron_create', 'encrypt_file', 'decrypt_file',
    ],
    permissions: [],
    prompt: 'You are in Plan mode. You DO NOT have permission to execute shell commands, write files, or make any changes to the system. Read/analysis tools (file_read, folder_list, code_search, grep, glob, code_references, web_search) are available for gathering information.\n\nCRITICAL RULES:\n- NEVER call shell_exec, file_write, or any write/mutate tool — they WILL be blocked.\n- If a task requires execution (shell commands, file writes, builds, installs), STOP and tell the user: "This requires Agent mode. Switch from Plan mode to continue."\n- DO NOT fabricate, hallucinate, or pretend any tool output. If a tool is blocked, admit it and ask the user to switch modes.\n- Focus on thorough analysis, architecture review, and producing a detailed step-by-step plan ONLY.',
    temperature: 0.2,
    color: '#2196F3',
  },
];
