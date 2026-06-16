import { execSync } from 'node:child_process';

export interface GitSnapshot {
  hash: string;
  timestamp: number;
  branch: string;
}

export class GitSnapshotManager {
  private repoPath: string;
  private snapshots: GitSnapshot[] = [];

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  isInsideRepo(): boolean {
    try {
      execSync('git rev-parse --git-dir', { cwd: this.repoPath, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { cwd: this.repoPath, encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  isDirty(): boolean {
    try {
      const status = execSync('git status --porcelain', { cwd: this.repoPath, encoding: 'utf-8' });
      return status.trim().length > 0;
    } catch {
      return false;
    }
  }

  snapshot(): GitSnapshot {
    const hash = execSync('git rev-parse HEAD', { cwd: this.repoPath, encoding: 'utf-8' }).trim();
    const branch = this.getBranch();
    const snap: GitSnapshot = { hash, timestamp: Date.now(), branch };
    this.snapshots.push(snap);
    return snap;
  }

  getLatestSnapshot(): GitSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1]! : null;
  }

  diffSinceSnapshot(snapshotHash?: string): string {
    const since = snapshotHash ?? this.snapshots[0]?.hash;
    if (!since) return '';
    try {
      return execSync(`git diff ${since} --stat`, { cwd: this.repoPath, encoding: 'utf-8' });
    } catch {
      return '';
    }
  }

  diffContent(snapshotHash?: string): string {
    const since = snapshotHash ?? this.snapshots[0]?.hash;
    if (!since) return '';
    try {
      return execSync(`git diff ${since}`, { cwd: this.repoPath, encoding: 'utf-8' });
    } catch {
      return '';
    }
  }
}
