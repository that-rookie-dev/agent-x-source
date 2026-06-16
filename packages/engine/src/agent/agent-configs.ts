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
    steps: 5,
    color: '#4CAF50',
  },
  {
    id: 'plan',
    name: 'Plan',
    mode: 'plan',
    description: 'Plan mode — analyzes tasks and creates plans without executing tools',
    defaultTools: [],
    deniedTools: [
      'file_write', 'file_delete', 'folder_create', 'folder_delete', 'shell_exec',
      'shell_background', 'db_query', 'db_migrate', 'package_install', 'package_remove',
    ],
    permissions: [
      { action: 'tool:*', pattern: 'file_write', effect: 'deny' },
      { action: 'tool:*', pattern: 'file_delete', effect: 'deny' },
      { action: 'tool:*', pattern: 'shell_exec', effect: 'deny' },
    ],
    prompt: 'You are in Plan mode. Analyze the task and create a detailed step-by-step plan. Do NOT execute any tools or make changes. Focus on analysis, architecture, and planning.',
    temperature: 0.2,
    steps: 3,
    color: '#2196F3',
  },
];
