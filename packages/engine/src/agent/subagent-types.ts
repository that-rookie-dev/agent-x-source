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
];
