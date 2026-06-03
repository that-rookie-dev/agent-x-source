import * as vscode from 'vscode';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

interface GitExtensionAPI {
  getAPI(version: number): {
    repositories: Array<{
      rootUri: vscode.Uri;
      state: {
        workingTreeChanges: Array<{ uri: vscode.Uri; status: number }>;
        indexChanges: Array<{ uri: vscode.Uri; status: number }>;
        refs: Array<{ name: string; commit: string; type: number }>;
        HEAD?: { name?: string; commit?: string };
      };
      diffWithHEAD?(uri?: vscode.Uri): Promise<string>;
      diffWithRef?(ref: string, uri?: vscode.Uri): Promise<string>;
    }>;
  };
}

function getGitExtension(): GitExtensionAPI | null {
  const ext = vscode.extensions.getExtension<GitExtensionAPI>('vscode.git');
  return ext?.isActive ? ext.exports : null;
}

function getRepoForWorkspace(api: ReturnType<GitExtensionAPI['getAPI']>, ws: string) {
  return api.repositories.find(
    (r) => r.rootUri.fsPath === ws || ws.startsWith(r.rootUri.fsPath),
  );
}

const STATUS_MAP: Record<number, string> = {
  0: '  ', 1: 'M ', 2: 'A ', 3: 'D ', 4: 'R ', 5: 'C ', 6: 'U ', 7: '? ',
};

function gitShell(cmd: string, cwd: string): ToolResult {
  try {
    const output = execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, output: output.trim() || '(no output)' };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'GIT_ERROR' };
  }
}

export function adaptGitVcs(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── git_status ──
  refs.executor.registerHandler('git_status', async (): Promise<ToolResult> => {
    const gitApi = getGitExtension()?.getAPI(1);
    if (gitApi) {
      const repo = getRepoForWorkspace(gitApi, ws);
      if (repo) {
        const lines: string[] = [];
        for (const change of repo.state.indexChanges) {
          const status = STATUS_MAP[change.status] ?? '? ';
          lines.push(`${status}${change.uri.fsPath.replace(ws + '/', '')}`);
        }
        for (const change of repo.state.workingTreeChanges) {
          const status = STATUS_MAP[change.status] ?? '? ';
          lines.push(`${status}${change.uri.fsPath.replace(ws + '/', '')}`);
        }
        const head = repo.state.HEAD;
        const header = head?.name ? `On branch ${head.name}` : `HEAD detached at ${head?.commit?.slice(0, 7) ?? 'unknown'}`;
        return {
          success: true,
          output: lines.length > 0 ? `${header}\n\n${lines.join('\n')}` : `${header}\n\nNothing to commit, working tree clean`,
        };
      }
    }
    return gitShell('status --short', ws);
  });
  result.overridden.push('git_status');

  // ── git_diff ──
  refs.executor.registerHandler('git_diff', async (args): Promise<ToolResult> => {
    const ref = args['ref'] as string | undefined;
    const file = (args['path'] ?? args['file']) as string | undefined;

    try {
      const gitApi = getGitExtension()?.getAPI(1);
      const repo = gitApi ? getRepoForWorkspace(gitApi, ws) : null;
      if (repo) {
        let diff: string;
        if (file) {
          const fileUri = vscode.Uri.file(resolve(ws, file));
          diff = ref
            ? await repo.diffWithRef!(ref, fileUri)
            : await repo.diffWithHEAD!(fileUri);
        } else {
          diff = ref
            ? await repo.diffWithRef!(ref)
            : await repo.diffWithHEAD!();
        }
        return { success: true, output: diff || '(no diff)' };
      }
    } catch {
      // Fall through to shell
    }

    let cmd = 'diff';
    if (ref) cmd += ` ${ref}`;
    if (file) cmd += ` -- ${file}`;
    return gitShell(cmd, ws);
  });
  result.overridden.push('git_diff');

  // ── Kept as-is ──
  result.keptAsIs.push(
    'git_log', 'git_commit', 'git_add', 'git_branch', 'git_checkout',
    'git_stash', 'git_blame', 'git_show', 'git_push', 'git_pull', 'git_merge',
  );

  return result;
}
