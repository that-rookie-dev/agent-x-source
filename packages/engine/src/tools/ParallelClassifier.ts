import { ParallelMode } from '@agentx/shared';
import type { ToolDefinition } from '@agentx/shared';

export interface ClassifiedTool {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  toolCallId: string;
}

export interface ParallelClassification {
  parallel: ClassifiedTool[];
  sequential: ClassifiedTool[];
}

const NEVER_PARALLEL = new Set([
  'question',
  'clarify',
  'approve',
  'ask_clarification',
  'ask_followup_question',
]);

/** Read-only / idempotent tools safe to run concurrently. */
const SAFE_PARALLEL = new Set([
  'glob',
  'grep',
  'file_read',
  'file_read_batch',
  'file_find',
  'file_info',
  'file_diff',
  'file_checksum',
  'file_metadata',
  'folder_list',
  'folder_tree',
  'list_dir',
  'search_files',
  'read',
  'read_file',
  'cat',
  'ls',
  'web_fetch',
  'webfetch',
  'web_search',
  'websearch',
  'web_browse',
  'web_scrape',
  'deep_web_search',
  'http_get',
  'git_status',
  'git_log',
  'git_diff',
  'git_blame',
  'git_show',
  'git_branch',
  'git_remote',
  'db_query',
  'db_schema',
  'code_search',
  'code_grep',
  'code_symbols',
  'code_definitions',
  'code_references',
  'code_analyze',
  'code_lint',
  'code_typecheck',
  'code_range',
  'json_parse',
  'json_query',
  'csv_parse',
  'regex_match',
  'text_diff',
  'validate_schema',
  'render_chart',
  'list',
  'search',
  'project_detect',
  'package_list',
  'package_outdated',
  'pkg_search',
  'pkg_audit',
  'gh_pr_view',
  'gh_pr_list',
  'gh_issue_list',
  'gh_repo_view',
  'gh_workflow_list',
  'memory_read',
  'memory_recall',
  'cortex_memory_search',
  'knowledge_base_search',
  'codebase_search',
  'system_info',
  'system_which',
  'system_disk',
  'system_ports',
  'system_env',
  'system_monitor',
  'system_tree_size',
  'env_read',
  'container_list',
  'container_logs',
  'container_images',
  'process_list',
  'browser_screenshot',
  'browser_extract',
  'agent_x_overview',
  'sub_agent_status',
]);

const SAFE_PREFIXES = [
  'memory_',
  'rag_',
  'system_',
];

const MUTATION_OPS = new Set([
  'write',
  'edit',
  'patch',
  'file_write',
  'file_delete',
  'file_edit',
  'file_patch',
  'file_copy',
  'write_file',
  'delete_file',
  'create_dir',
  'folder_create',
  'folder_delete',
  'folder_move',
  'code_replace',
  'code_insert',
  'apply_patch',
  'git_commit',
  'git_checkout',
  'git_add',
  'git_push',
  'git_pull',
  'git_merge',
  'git_rebase',
  'git_reset',
  'git_stash',
  'git_cherry_pick',
]);

export class ParallelClassifier {
  classify(tools: ClassifiedTool[]): ParallelClassification {
    const parallel: ClassifiedTool[] = [];
    const sequential: ClassifiedTool[] = [];

    for (const tool of tools) {
      const mode = tool.tool.parallelMode ?? this.inferMode(tool);

      switch (mode) {
        case ParallelMode.NEVER:
          sequential.push(tool);
          break;

        case ParallelMode.SAFE:
          parallel.push(tool);
          break;

        case ParallelMode.PATH_SCOPED: {
          const existing = [...parallel, ...sequential];
          if (this.hasNonOverlappingPaths(tool, existing)) {
            parallel.push(tool);
          } else {
            sequential.push(tool);
          }
          break;
        }

        case ParallelMode.INTEGRATION_CHECK:
          sequential.push(tool);
          break;

        case ParallelMode.SEQUENTIAL:
        default:
          sequential.push(tool);
          break;
      }
    }

    return { parallel, sequential };
  }

  private toolKeys(tool: ClassifiedTool): string[] {
    const keys = [tool.tool.id, tool.tool.name].filter(Boolean);
    return [...new Set(keys)];
  }

  private inferMode(tool: ClassifiedTool): ParallelMode {
    const keys = this.toolKeys(tool);

    if (keys.some((k) => NEVER_PARALLEL.has(k))) {
      return ParallelMode.NEVER;
    }

    if (keys.some((k) => SAFE_PARALLEL.has(k))) {
      return ParallelMode.SAFE;
    }

    if (keys.some((k) => SAFE_PREFIXES.some((p) => k.startsWith(p)))) {
      return ParallelMode.SAFE;
    }

    if (keys.some((k) => MUTATION_OPS.has(k))) {
      return ParallelMode.PATH_SCOPED;
    }

    if (tool.tool.id.startsWith('integration__')) {
      return ParallelMode.INTEGRATION_CHECK;
    }

    // Low-risk read-ish categories default to SAFE when not otherwise classified
    if (
      tool.tool.riskLevel === 'low' &&
      (tool.tool.category === 'filesystem' ||
        tool.tool.category === 'code_intelligence' ||
        tool.tool.category === 'web_network' ||
        tool.tool.category === 'ai_meta' ||
        tool.tool.category === 'agent_meta')
    ) {
      const id = tool.tool.id;
      if (
        !id.includes('write') &&
        !id.includes('delete') &&
        !id.includes('edit') &&
        !id.includes('exec') &&
        !id.includes('run') &&
        !id.includes('create')
      ) {
        return ParallelMode.SAFE;
      }
    }

    return ParallelMode.SEQUENTIAL;
  }

  private hasNonOverlappingPaths(
    tool: ClassifiedTool,
    existing: ClassifiedTool[],
  ): boolean {
    const toolPaths = this.extractPaths(tool);

    if (toolPaths.length === 0) {
      return existing.length === 0;
    }

    for (const existingTool of existing) {
      const existingPaths = this.extractPaths(existingTool);
      for (const tp of toolPaths) {
        for (const ep of existingPaths) {
          if (this.isPathOverlapping(tp, ep)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private extractPaths(tool: ClassifiedTool): string[] {
    const paths: string[] = [];

    const candidates = [
      tool.args.filePath,
      tool.args.filepath,
      tool.args.path,
      tool.args.targetPath,
      tool.args.target,
      tool.args.folderPath,
      tool.args.directory,
      tool.args.from,
      tool.args.to,
    ];

    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) {
        paths.push(c);
      }
    }

    if (Array.isArray(tool.args.paths)) {
      for (const p of tool.args.paths) {
        if (typeof p === 'string') paths.push(p);
      }
    }

    if (typeof tool.args.files === 'object' && tool.args.files !== null) {
      const files = tool.args.files as Record<string, unknown>;
      for (const v of Object.values(files)) {
        if (typeof v === 'string') paths.push(v);
      }
    }

    return paths;
  }

  private isPathOverlapping(a: string, b: string): boolean {
    const partsA = a.replace(/^\/+|\/+$/g, '').split('/');
    const partsB = b.replace(/^\/+|\/+$/g, '').split('/');

    const minLen = Math.min(partsA.length, partsB.length);

    for (let i = 0; i < minLen; i++) {
      if (partsA[i] !== partsB[i]) return false;
    }

    return true;
  }
}
