import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface GitManagerOptions {
  scopePath?: string;
  branchPrefix?: string;
}

export class GitManager {
  private scopePath: string;
  private branchPrefix: string;
  private repoRoot: string | null = null;
  private trackedFilesCache: string[] | null = null;
  private snapshots: Array<{ hash: string; timestamp: number; step: number }> = [];
  private currentStep = 0;

  constructor(options: GitManagerOptions = {}) {
    this.scopePath = options.scopePath ?? process.cwd();
    this.branchPrefix = options.branchPrefix ?? 'session/';
    this.repoRoot = this.findRepoRoot();
  }

  isInsideRepo(): boolean {
    return this.repoRoot !== null;
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  isPathInsideRepo(absolutePath: string): boolean {
    if (!this.repoRoot) return false;
    return resolve(absolutePath).startsWith(this.repoRoot + '/') || resolve(absolutePath) === this.repoRoot;
  }

  getTrackedFiles(forceRefresh = false): string[] {
    if (this.trackedFilesCache && !forceRefresh) return this.trackedFilesCache;
    if (!this.repoRoot) return [];
    try {
      const output = execSync('git ls-files', {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      this.trackedFilesCache = output.trim().split('\n').filter(Boolean);
      return this.trackedFilesCache;
    } catch {
      this.trackedFilesCache = [];
      return [];
    }
  }

  getUntrackedFiles(): string[] {
    if (!this.repoRoot) return [];
    try {
      const output = execSync('git ls-files --others --exclude-standard', {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  ensureBranch(): boolean {
    if (!this.repoRoot) return false;
    const branchName = this.getBranchName();
    try {
      execSync(`git checkout -b "${branchName}" 2>/dev/null || git checkout "${branchName}"`, {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  commitSessionExport(sessionId: string, messages: unknown[], message: string): boolean {
    if (!this.repoRoot) return false;
    try {
      this.ensureBranch();
      const sessionDir = join(this.repoRoot, '.agentx', 'sessions');
      mkdirSync(sessionDir, { recursive: true });
      const filePath = join(sessionDir, `${sessionId}.json`);
      writeFileSync(filePath, JSON.stringify({ sessionId, messages, exportedAt: new Date().toISOString() }, null, 2), 'utf-8');
      execSync(`git add "${filePath}"`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 });
      execSync(`git commit -m "session(${sessionId.slice(0, 8)}): ${message}" --allow-empty`, {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  commitAfterEdit(filePath: string, sessionId?: string): boolean {
    if (!this.repoRoot) return false;
    try {
      this.ensureBranch();
      const rel = resolve(filePath).startsWith(this.repoRoot)
        ? resolve(filePath).slice(this.repoRoot.length + 1)
        : filePath;
      execSync(`git add "${resolve(filePath)}"`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 });
      const tag = sessionId ? `session(${sessionId.slice(0, 8)})` : 'auto';
      execSync(`git commit -m "${tag}: auto-commit ${rel}" --allow-empty`, {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  getBranchName(sessionId?: string): string {
    return sessionId ? `${this.branchPrefix}${sessionId.slice(0, 8)}` : `${this.branchPrefix}auto`;
  }

  /**
   * Take a git tree snapshot at the start of a step.
   * Returns the tree hash that can be used later for diff/undo.
   */
  snapshot(): string | null {
    if (!this.repoRoot) return null;
    try {
      this.currentStep++;
      const hash = execSync('git write-tree', { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 }).trim();
      this.snapshots.push({ hash, timestamp: Date.now(), step: this.currentStep });
      return hash;
    } catch {
      return null;
    }
  }

  /**
   * Get the diff between two snapshots or between the last snapshot and current state.
   */
  diff(fromHash?: string): string | null {
    if (!this.repoRoot) return null;
    try {
      const last = this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : undefined;
      const from = fromHash || last?.hash || 'HEAD~1';
      return execSync(`git diff ${from}`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 10000 });
    } catch {
      return null;
    }
  }

  /**
   * Revert files to a previous snapshot state.
   * Crash-safe: if git checkout fails, stashes local changes and retries.
   */
  revert(hash?: string): boolean {
    if (!this.repoRoot) return false;
    try {
      const last = this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : undefined;
      const targetHash = hash || last?.hash || 'HEAD';
      execSync(`git checkout ${targetHash} -- .`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 10000 });
      return true;
    } catch (err) {
      // Crash-safe fallback: stash local changes first, then retry
      try {
        execSync('git stash --include-untracked 2>/dev/null', { cwd: this.repoRoot, encoding: 'utf-8', timeout: 10000 });
        const last = this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : undefined;
        const targetHash = hash || last?.hash || 'HEAD';
        execSync(`git checkout ${targetHash} -- .`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 10000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * List all snapshots with their hashes, timestamps, and step numbers.
   */
  listSnapshots(): Array<{ hash: string; timestamp: number; step: number }> {
    return [...this.snapshots];
  }

  /**
   * Push the current branch to origin.
   */
  pushBranch(): boolean {
    if (!this.repoRoot) return false;
    try {
      execSync('git push -u origin HEAD 2>&1', { cwd: this.repoRoot, encoding: 'utf-8', timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a PR using gh CLI. Returns the PR URL or null.
   */
  createPR(title: string, body: string): string | null {
    if (!this.repoRoot) return null;
    try {
      const output = execSync(
        `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').slice(0, 2000)}" 2>&1`,
        { cwd: this.repoRoot, encoding: 'utf-8', timeout: 30000 },
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Watch CI for the latest commit on the current branch.
   * Polls gh run watch with a timeout. Returns 'success', 'failure', or 'timeout'.
   */
  watchCI(timeoutMs = 300_000): string {
    if (!this.repoRoot) return 'failure';
    try {
      execSync(`gh run watch --exit-status 2>&1`, {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: timeoutMs,
      });
      return 'success';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('no runs')) return 'success';
      return 'failure';
    }
  }

  /**
   * Get CI status for the latest commit.
   */
  getCIStatus(): { state: string; url: string } | null {
    if (!this.repoRoot) return null;
    try {
      const output = execSync(
        `gh run list --branch HEAD --limit 1 --json conclusion,displayTitle,url 2>/dev/null`,
        { cwd: this.repoRoot, encoding: 'utf-8', timeout: 10000 },
      );
      const runs = JSON.parse(output.trim()) as Array<{ conclusion: string | null; displayTitle: string; url: string }>;
      if (runs.length === 0) return null;
      const state = runs[0]!.conclusion || 'in_progress';
      return { state, url: runs[0]!.url };
    } catch {
      return null;
    }
  }

  /**
   * Get the remote origin URL.
   */
  getRemoteUrl(): string | null {
    if (!this.repoRoot) return null;
    try {
      const output = execSync('git remote get-url origin 2>/dev/null', {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      });
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if there are unresolved merge conflicts in the repo.
   */
  hasConflicts(): boolean {
    if (!this.repoRoot) return false;
    try {
      const output = execSync('git ls-files -u 2>/dev/null | head -1', {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get list of files with merge conflicts.
   */
  getConflictFiles(): string[] {
    if (!this.repoRoot) return [];
    try {
      const output = execSync(
        "git diff --name-only --diff-filter=U 2>/dev/null || git ls-files -u 2>/dev/null | awk '{print $4}' | sort -u",
        { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 },
      );
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get the conflict-marker content of a file (for LLM resolution).
   */
  getConflictContent(filePath: string): string | null {
    if (!this.repoRoot) return null;
    try {
      return execSync(`git show :2:${filePath} 2>/dev/null && echo '===CONFLICT_SEPARATOR===' && git show :3:${filePath} 2>/dev/null`, {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      }).trim();
    } catch {
      return null;
    }
  }

  /**
   * Write resolved content for a conflicted file, then mark as resolved.
   */
  resolveConflict(filePath: string, resolvedContent: string): boolean {
    if (!this.repoRoot) return false;
    try {
      writeFileSync(resolve(this.repoRoot, filePath), resolvedContent, 'utf-8');
      execSync(`git add "${filePath}"`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private findRepoRoot(): string | null {
    try {
      const output = execSync('git rev-parse --show-toplevel 2>/dev/null', {
        cwd: this.scopePath,
        encoding: 'utf-8',
        timeout: 5000,
      });
      const root = output.trim();
      return root || null;
    } catch {
      return null;
    }
  }
}
