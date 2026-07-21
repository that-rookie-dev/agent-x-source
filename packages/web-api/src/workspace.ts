import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import {
  ensureBuiltinWorkspaceDir,
  getDataDir,
  isBuiltinWorkspacePath,
  isPathInsideRoot,
  resolveWorkspacePath,
  type AgentXConfig,
  type TurnAttachment,
} from '@agentx/shared';
import { getEngine } from './engine/state.js';

export type WorkspaceMigrateMode = 'switch' | 'copy' | 'move';

export interface WorkspaceInfo {
  path: string;
  builtinPath: string;
  isBuiltin: boolean;
}

/** Active global workspace from config (creates built-in dir if needed). */
export function getWorkspaceInfo(cfg?: AgentXConfig): WorkspaceInfo {
  const config = cfg ?? getEngine().configManager.load();
  const builtinPath = ensureBuiltinWorkspaceDir();
  const path = resolveWorkspacePath(config.workspacePath);
  return {
    path,
    builtinPath,
    isBuiltin: isBuiltinWorkspacePath(path),
  };
}

export function getActiveWorkspacePath(cfg?: AgentXConfig): string {
  return getWorkspaceInfo(cfg).path;
}

/** Reject using the app data root / sessions / db as a workspace. */
export function assertValidWorkspacePath(path: string): string {
  const resolved = resolve(path);
  const dataDir = resolve(getDataDir());
  if (resolved === dataDir) {
    throw new Error('Workspace cannot be the Agent-X data directory itself');
  }
  const blocked = ['sessions', 'db', 'logs', 'cache', 'uploads', 'markdown'];
  for (const name of blocked) {
    const blockedPath = resolve(join(dataDir, name));
    if (resolved === blockedPath || resolved.startsWith(blockedPath + '/')) {
      throw new Error(`Workspace cannot be inside Agent-X ${name} storage`);
    }
  }
  return resolved;
}

/**
 * Chat-ingress guard for workspace @file / @folder attachments.
 * - originalPath only allowed with source=workspace
 * - path must resolve inside the active workspace (symlink-safe)
 */
export function assertChatWorkspaceAttachments(
  attachments: TurnAttachment[] | undefined,
  workspaceRoot: string = getActiveWorkspacePath(),
): { ok: true; attachments: TurnAttachment[] } | { ok: false; error: string; details?: unknown } {
  if (!attachments?.length) return { ok: true, attachments: [] };

  const cleaned: TurnAttachment[] = [];
  for (const a of attachments) {
    const hasPath = typeof a.originalPath === 'string' && a.originalPath.length > 0;
    if (!hasPath && a.source !== 'workspace') {
      cleaned.push(a);
      continue;
    }

    if (a.source && a.source !== 'workspace') {
      return {
        ok: false,
        error: 'originalPath is only allowed for workspace attachments',
        details: { name: a.name, source: a.source },
      };
    }
    if (!hasPath) {
      return {
        ok: false,
        error: 'workspace attachments require originalPath',
        details: { name: a.name },
      };
    }
    if (!isPathInsideRoot(a.originalPath!, workspaceRoot)) {
      return {
        ok: false,
        error: `Attachment path is outside the workspace: ${a.name}`,
        details: { name: a.name, originalPath: a.originalPath, workspace: workspaceRoot },
      };
    }
    cleaned.push({ ...a, source: 'workspace', type: a.type ?? 'file' });
  }
  return { ok: true, attachments: cleaned };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function transferContents(from: string, to: string, mode: 'copy' | 'move'): Promise<number> {
  if (!(await pathExists(from))) return 0;
  await mkdir(to, { recursive: true });
  const entries = await readdir(from);
  let count = 0;
  for (const name of entries) {
    const src = join(from, name);
    const dest = join(to, name);
    if (mode === 'copy') {
      await cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    } else {
      try {
        await rename(src, dest);
      } catch {
        await cp(src, dest, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    }
    count += 1;
  }
  return count;
}

/**
 * Set global workspace. Optionally migrate content from the previous workspace.
 * Updates config, active session scope, and live agent scope.
 */
export async function setWorkspacePath(
  nextPath: string,
  mode: WorkspaceMigrateMode = 'switch',
): Promise<WorkspaceInfo & { migrated: number }> {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const previous = getActiveWorkspacePath(cfg);
  const resolved = assertValidWorkspacePath(nextPath);
  await mkdir(resolved, { recursive: true });

  let migrated = 0;
  if (mode !== 'switch' && resolve(previous) !== resolved) {
    migrated = await transferContents(previous, resolved, mode);
  }

  const nextCfg: AgentXConfig = {
    ...cfg,
    workspacePath: resolved,
  };
  eng.configManager.save(nextCfg);

  const sess = eng.sessionManager.getActiveSession();
  if (sess) {
    try {
      eng.sessionManager.updateSession({ scopePath: resolved });
    } catch { /* best-effort */ }
  }

  const agent = eng.agent;
  if (agent && typeof agent.setScopePath === 'function') {
    agent.setScopePath(resolved);
  }
  try {
    eng.toolkit?.executor?.setScopePath?.(resolved);
  } catch { /* best-effort */ }

  return { ...getWorkspaceInfo(nextCfg), migrated };
}

export function ensureWorkspaceReady(): string {
  const info = getWorkspaceInfo();
  // Touch parent so dirname calls in tools never surprise.
  void dirname(info.path);
  return info.path;
}
