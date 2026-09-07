import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { getLogger } from '@agentx/shared';

/**
 * Project repository abstraction — mirrors MetaGPT's `ProjectRepo` / `GitRepository`
 * (repos/metagpt/metagpt/utils/project_repo.py, MIT licensed).
 *
 * Tracks files written by the Engineering Crew, their dependencies, and changed-file
 * state. This enables:
 * - The Engineer to know which files exist and what changed
 * - The QaEngineer to know which files need tests
 * - Incremental mode to track what changed between runs
 * - The Reviewer to verify all expected files were produced
 */
export interface TrackedFile {
  filename: string;
  rootRelativePath: string;
  content: string;
  dependencies: string[];
  changed: boolean;
  changeType: 'added' | 'modified' | 'deleted' | 'untracked';
}

export class ProjectRepo {
  readonly workdir: string;
  readonly srcPath: string;
  readonly testPath: string;

  private srcFiles = new Map<string, TrackedFile>();
  private testFiles = new Map<string, TrackedFile>();
  private docsFiles = new Map<string, TrackedFile>();

  constructor(workdir: string, srcPath?: string) {
    this.workdir = workdir;
    this.srcPath = srcPath ?? join(workdir, 'src');
    this.testPath = join(workdir, 'tests');
  }

  /** Ensure a filename is safe: no absolute paths, no parent-directory traversal.
   * Also strip a redundant `<base>/` prefix so files don't end up in nested dirs. */
  private normalizeAndCheck(filename: string, base: string): string {
    if (filename.startsWith('/')) {
      throw new Error(`Refusing to write absolute path: ${filename}`);
    }
    if (filename.includes('..')) {
      throw new Error(`Refusing to write path with parent traversal: ${filename}`);
    }
    const prefix = `${base}/`;
    if (filename.startsWith(prefix) && filename.length > prefix.length) {
      return filename.slice(prefix.length);
    }
    return filename;
  }

  // ─── Source files ───
  async saveSrc(filename: string, content: string, dependencies: string[] = []): Promise<TrackedFile> {
    const safeFilename = this.normalizeAndCheck(filename, 'src');
    const fullPath = join(this.srcPath, safeFilename);
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      const existed = existsSync(fullPath);
      writeFileSync(fullPath, content);
      const rootRelative = relative(this.workdir, fullPath);
      const file: TrackedFile = {
        filename: safeFilename,
        rootRelativePath: rootRelative,
        content,
        dependencies,
        changed: true,
        changeType: existed ? 'modified' : 'added',
      };
      this.srcFiles.set(safeFilename, file);
      return file;
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_REPO', `saveSrc failed for ${filename}: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  async getSrc(filename: string): Promise<TrackedFile | undefined> {
    const safeFilename = this.normalizeAndCheck(filename, 'src');
    const tracked = this.srcFiles.get(safeFilename);
    if (tracked) return tracked;
    // Try reading from disk
    const fullPath = join(this.srcPath, safeFilename);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      const rootRelative = relative(this.workdir, fullPath);
      return { filename: safeFilename, rootRelativePath: rootRelative, content, dependencies: [], changed: false, changeType: 'untracked' };
    }
    return undefined;
  }

  getSrcFiles(): TrackedFile[] {
    return [...this.srcFiles.values()];
  }

  getChangedSrcFiles(): TrackedFile[] {
    return this.getSrcFiles().filter((f) => f.changed);
  }

  // ─── Test files ───
  async saveTest(filename: string, content: string, dependencies: string[] = []): Promise<TrackedFile> {
    const safeFilename = this.normalizeAndCheck(filename, 'tests');
    const fullPath = join(this.testPath, safeFilename);
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      const existed = existsSync(fullPath);
      writeFileSync(fullPath, content);
      const rootRelative = relative(this.workdir, fullPath);
      const file: TrackedFile = {
        filename: safeFilename,
        rootRelativePath: rootRelative,
        content,
        dependencies,
        changed: true,
        changeType: existed ? 'modified' : 'added',
      };
      this.testFiles.set(safeFilename, file);
      return file;
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_REPO', `saveTest failed for ${filename}: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  async getTest(filename: string): Promise<TrackedFile | undefined> {
    const safeFilename = this.normalizeAndCheck(filename, 'tests');
    const tracked = this.testFiles.get(safeFilename);
    if (tracked) return tracked;
    const fullPath = join(this.testPath, safeFilename);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      const rootRelative = relative(this.workdir, fullPath);
      return { filename: safeFilename, rootRelativePath: rootRelative, content, dependencies: [], changed: false, changeType: 'untracked' };
    }
    return undefined;
  }

  getTestFiles(): TrackedFile[] {
    return [...this.testFiles.values()];
  }

  getChangedTestFiles(): TrackedFile[] {
    return this.getTestFiles().filter((f) => f.changed);
  }

  // ─── Docs files ───
  async saveDoc(filename: string, content: string, dependencies: string[] = []): Promise<TrackedFile> {
    const safeFilename = this.normalizeAndCheck(filename, 'docs');
    const fullPath = join(this.workdir, 'docs', safeFilename);
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
      const rootRelative = relative(this.workdir, fullPath);
      const file: TrackedFile = {
        filename: safeFilename,
        rootRelativePath: rootRelative,
        content,
        dependencies,
        changed: true,
        changeType: 'added',
      };
      this.docsFiles.set(safeFilename, file);
      return file;
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_REPO', `saveDoc failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  // ─── Dependency tracking ───
  /** Get all files that the given file depends on (transitive). */
  getDependencies(filename: string): string[] {
    const safeStart = this.normalizeAndCheck(filename, 'src');
    const visited = new Set<string>();
    const queue = [safeStart];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const file = this.srcFiles.get(current);
      if (file) {
        for (const dep of file.dependencies) {
          const safeDep = this.normalizeAndCheck(dep, 'src');
          if (!visited.has(safeDep)) queue.push(safeDep);
        }
      }
    }
    return [...visited].filter((f) => f !== safeStart);
  }

  // ─── Disk scanning ───
  /** Scan the workdir for all existing source files (for incremental mode). */
  scanExistingFiles(): string[] {
    const files: string[] = [];
    try {
      if (existsSync(this.srcPath)) {
        scanDir(this.srcPath, this.srcPath, files);
      }
    } catch { /* ignore */ }
    return files;
  }

  // ─── State ───
  /** Mark all files as unchanged (after a round is complete). */
  markAllUnchanged(): void {
    for (const f of this.srcFiles.values()) f.changed = false;
    for (const f of this.testFiles.values()) f.changed = false;
    for (const f of this.docsFiles.values()) f.changed = false;
  }

  /** Get a summary of the repo state. */
  getSummary(): { srcCount: number; testCount: number; changedCount: number } {
    return {
      srcCount: this.srcFiles.size,
      testCount: this.testFiles.size,
      changedCount: this.getChangedSrcFiles().length + this.getChangedTestFiles().length,
    };
  }
}

function scanDir(basePath: string, currentPath: string, files: string[]): void {
  try {
    const entries = readdirSync(currentPath);
    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        // Skip common non-source directories
        if (entry === 'node_modules' || entry === '.git' || entry === '__pycache__' || entry === 'dist' || entry === 'build' || entry === 'target') continue;
        scanDir(basePath, fullPath, files);
      } else {
        files.push(relative(basePath, fullPath));
      }
    }
  } catch { /* ignore */ }
}
