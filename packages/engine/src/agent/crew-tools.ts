import type { Crew } from '@agentx/shared';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { buildCrewVoiceBlock } from './crew-persona.js';

/** Default tool bundles by domain keyword — used when crew has no explicit tool list. */
const DOMAIN_TOOL_BUNDLES: Record<string, string[]> = {
  devops: ['shell_exec', 'file_read', 'file_write', 'folder_list', 'container_list', 'container_run', 'container_compose', 'git_status', 'git_diff', 'test_run'],
  backend: ['file_read', 'file_write', 'code_search', 'code_replace', 'code_insert', 'shell_exec', 'test_run', 'test_coverage', 'git_diff', 'git_commit'],
  frontend: ['file_read', 'file_write', 'code_search', 'code_replace', 'browser_open', 'browser_screenshot', 'test_run', 'package_run'],
  design: ['file_read', 'file_write', 'doc_markdown', 'doc_html', 'browser_open', 'browser_screenshot'],
  security: ['file_read', 'code_search', 'code_grep', 'security_audit', 'security_secrets', 'shell_exec'],
  compliance: ['file_read', 'folder_list', 'glob', 'grep', 'code_search', 'code_grep', 'code_definitions', 'security_audit', 'security_secrets', 'pkg_audit', 'git_status', 'git_diff', 'git_log', 'env_read', 'container_list', 'container_logs', 'shell_exec', 'json_parse', 'pdf_read', 'doc_markdown', 'test_run', 'http_get'],
  data: ['file_read', 'file_write', 'db_query', 'json_parse', 'csv_parse', 'pdf_read', 'shell_exec'],
  finance: ['file_read', 'pdf_read', 'csv_parse', 'json_parse', 'doc_markdown'],
  tax: ['file_read', 'pdf_read', 'csv_parse', 'json_parse', 'doc_markdown'],
};

const CORE_CREW_TOOLS = [
  'file_read', 'file_write', 'file_delete', 'folder_list', 'folder_create',
  'code_search', 'code_replace', 'code_insert', 'code_grep', 'code_definitions',
  'shell_exec', 'test_run', 'test_coverage', 'git_status', 'git_diff', 'git_commit',
  'browser_open', 'browser_screenshot', 'http_get', 'http_post',
  'pdf_read', 'csv_parse', 'json_parse', 'doc_markdown',
  'crew_message', 'crew_response',
];

const DENIED_CREW_WORKER_TOOLS = new Set([
  'sub_agent_spawn', 'sub_agent_status', 'sub_agent_cancel',
  'delegate_to_crew', 'spawn_crew_workers',
]);

const WRITE_CREW_TOOLS = new Set([
  'file_write', 'file_delete', 'folder_create',
  'code_replace', 'code_insert', 'shell_exec',
  'git_commit', 'container_run', 'container_compose', 'container_start', 'container_stop',
  'container_exec', 'docker_build', 'package_install',
]);

/** Read / research tools — always available regardless of session mode. */
const READ_CREW_TOOLS = new Set([
  'file_read', 'folder_list', 'code_search', 'code_grep', 'code_definitions',
  'glob', 'grep', 'pdf_read', 'csv_parse', 'json_parse', 'http_get',
  'browser_open', 'browser_screenshot', 'doc_markdown', 'git_status', 'git_diff',
  'git_log', 'test_run', 'test_coverage', 'db_query', 'web_search', 'web_fetch',
]);

export function resolveCrewToolIds(crew: Crew, planMode = false): string[] {
  let ids: string[];

  if (crew.tools && crew.tools.length > 0) {
    ids = crew.tools.filter((t) => !DENIED_CREW_WORKER_TOOLS.has(t));
  } else {
    const enabled = crew.toolPreferences?.enabled;
    if (enabled && enabled.length > 0) {
      ids = enabled.filter((t) => !DENIED_CREW_WORKER_TOOLS.has(t));
    } else {
      const disabled = new Set(crew.toolPreferences?.disabled ?? []);
      const expertise = (crew.expertise ?? []).map((e) => e.toLowerCase());
      const prompt = crew.systemPrompt.toLowerCase();
      const bundle = new Set<string>(CORE_CREW_TOOLS);

      for (const [domain, tools] of Object.entries(DOMAIN_TOOL_BUNDLES)) {
        if (expertise.some((e) => e.includes(domain)) || prompt.includes(domain)) {
          for (const t of tools) bundle.add(t);
        }
      }

      ids = [...bundle].filter((t) => !disabled.has(t) && !DENIED_CREW_WORKER_TOOLS.has(t));
    }
  }

  if (planMode) {
    ids = ids.filter((t) => !WRITE_CREW_TOOLS.has(t));
    // Ensure read/research tools remain even if crew config omitted them
    for (const t of READ_CREW_TOOLS) {
      if (!ids.includes(t)) ids.push(t);
    }
  }
  return ids;
}

export function buildFilteredRegistry(parentRegistry: ToolRegistry, toolIds: string[]): ToolRegistry {
  const filtered = new ToolRegistry();
  for (const id of toolIds) {
    const def = parentRegistry.get(id);
    if (def) filtered.register(def);
  }
  return filtered;
}

export function buildCrewWorkerSystemPrompt(crew: Crew, sharedContext?: string): string {
  const lines: string[] = [
    '[CREW_IDENTITY]',
    `You are ${crew.name}${crew.title ? `, ${crew.title}` : ''}.`,
    `Respond ONLY as ${crew.name} — never as Agent-X or "the assistant".`,
  ];
  if (crew.description) lines.push(crew.description);
  lines.push(crew.systemPrompt);
  if (crew.traits?.length) lines.push(`Traits: ${crew.traits.join(', ')}`);
  if (crew.expertise?.length) lines.push(`Expertise: ${crew.expertise.join(', ')}`);
  const voice = buildCrewVoiceBlock(crew);
  if (voice) lines.push('', voice);
  lines.push('');
  lines.push('You are a crew worker on a team mission. EXECUTE tasks — do not only describe plans.');
  lines.push('Use tools aggressively: read → analyze → research → verify.');
  lines.push('Write for the user in chat: use rich Markdown (headings, lists, tables, code blocks) when it helps clarity.');
  if (sharedContext?.includes('PLAN MODE') || sharedContext?.toLowerCase().includes('read-only')) {
    lines.push('READ-ONLY MODE: use read/search/research tools freely. Do NOT write files or run mutating shell commands.');
    lines.push('Deliver your full analysis, plan, or findings as a markdown response message. If execution would require writes, describe what you would do and include draft content inline.');
  }
  lines.push('If blocked, use crew_message to ask another crew member or Agent-X for clarity.');
  lines.push('When done, summarize what you built, tested, and verified.');
  lines.push('[/CREW_IDENTITY]');
  if (sharedContext) {
    lines.push('', '[SHARED MISSION CONTEXT]', sharedContext, '[/SHARED MISSION CONTEXT]');
  }
  return lines.join('\n');
}
