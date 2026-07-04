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

  private inferMode(tool: ClassifiedTool): ParallelMode {
    const NEVER_PARALLEL = new Set([
      'question',
      'clarify',
      'approve',
      'ask_clarification',
      'ask_followup_question',
    ]);

    const SAFE_PARALLEL = new Set([
      'glob',
      'grep',
      'file_read',
      'read',
      'ls',
      'file_find',
      'web_fetch',
      'webfetch',
      'web_search',
      'websearch',
      'git_status',
      'git_log',
      'git_diff',
      'git_blame',
      'git_show',
      'db_query',
      'db_schema',
      'code_search',
      'code_grep',
      'code_symbols',
      'code_definitions',
      'code_references',
      'json_parse',
      'csv_parse',
      'validate_schema',
      'list',
      'search',
      'project_detect',
    ]);

    if (NEVER_PARALLEL.has(tool.tool.name)) {
      return ParallelMode.NEVER;
    }

    if (SAFE_PARALLEL.has(tool.tool.name)) {
      return ParallelMode.SAFE;
    }

    const mutationOps = new Set([
      'write',
      'edit',
      'patch',
      'file_write',
      'file_delete',
      'file_patch',
      'code_replace',
      'code_insert',
      'git_commit',
      'git_checkout',
    ]);

    if (mutationOps.has(tool.tool.name)) {
      return ParallelMode.PATH_SCOPED;
    }

    if (tool.tool.id.startsWith('integration__') || tool.tool.id.startsWith('integration:')) {
      return ParallelMode.INTEGRATION_CHECK;
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
