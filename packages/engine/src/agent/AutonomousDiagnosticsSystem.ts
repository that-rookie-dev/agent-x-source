import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLogger } from '@agentx/shared';

export interface SessionContext {
  scopePath: string;
  initialFileCount: number;
  fileCache: string[];
  directoryStructure: DirectoryTree;
  timestamps: { initialized: number; lastUpdate: number };
  discoveredPaths: Map<string, string>; // filename -> full path mapping
  fallbackReason?: string;
}

export interface DirectoryTree {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: DirectoryTree[];
}

export interface FileResolution {
  success: boolean;
  found: boolean;
  fullPath?: string;
  directory?: string;
  matchQuality: 'exact' | 'fuzzy' | 'none';
  message: string;
  suggestions?: string[];
}

export class AutonomousDiagnosticsSystem {
  private sessionContext: SessionContext | null = null;
  private searchPaths: string[] = [];
  private logger = getLogger();

  constructor() {
    this.initializeSearchPaths();
  }

  /**
   * Initialize common search paths in order of priority
   */
  private initializeSearchPaths(): void {
    this.searchPaths = [
      // Will be set to scopePath on session init
      process.cwd(),
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Documents'),
      path.join(os.homedir(), 'Downloads'),
      path.join(os.homedir(), '.config'),
      '/tmp',
      '/var/tmp',
    ];
  }

  /**
    * PHASE 1: Session Health Check
    * Verify scope_path is accessible and build initial context
    */
  async performSessionHealthCheck(scopePath: string): Promise<SessionContext & { healthy?: boolean; fileCount?: number; message?: string; fallbackReason?: string }> {
    this.logger.info('DIAGNOSTICS', 'Starting session health check...');

    try {
      // Verify path exists
      const stats = await fs.promises.stat(scopePath);
      if (!stats.isDirectory()) {
        throw new Error(`${scopePath} is not a directory`);
      }

      // Read directory contents
      const files = await fs.promises.readdir(scopePath);

      // Build directory tree
      const dirTree = await this.buildDirectoryTree(scopePath, 3);

      // Initialize session context
      this.sessionContext = {
        scopePath,
        initialFileCount: files.length,
        fileCache: files,
        directoryStructure: dirTree,
        timestamps: {
          initialized: Date.now(),
          lastUpdate: Date.now(),
        },
        discoveredPaths: new Map(),
      };

      // Pre-cache all discoverable files
      await this.cacheAllFiles(scopePath);

      // Update search paths with scopePath as priority
      this.searchPaths = [
        scopePath,
        ...this.searchPaths.filter((p) => p !== scopePath),
      ];

      this.logger.info(
        'DIAGNOSTICS',
        `✅ Session healthy. Found ${files.length} items in ${scopePath}`
      );

      return {
        ...this.sessionContext!,
        healthy: true,
        fileCount: files.length,
        message: `INITIALIZED: Session scope verified. ${files.length} files indexed.`,
      };
    } catch (error) {
      this.logger.error(
        'DIAGNOSTICS',
        `❌ Health check failed: ${error instanceof Error ? error.message : String(error)}`
      );

      // Fallback to Desktop
      const fallbackPath = path.join(os.homedir(), 'Desktop');
      this.logger.warn('DIAGNOSTICS', `Attempting fallback to ${fallbackPath}`);

      try {
        const stats = await fs.promises.stat(fallbackPath);
        if (stats.isDirectory()) {
          const files = await fs.promises.readdir(fallbackPath);
          const dirTree = await this.buildDirectoryTree(fallbackPath, 3);

          this.sessionContext = {
            scopePath: fallbackPath,
            initialFileCount: files.length,
            fileCache: files,
            directoryStructure: dirTree,
            timestamps: {
              initialized: Date.now(),
              lastUpdate: Date.now(),
            },
            discoveredPaths: new Map(),
          };

          this.searchPaths = [fallbackPath, ...this.searchPaths.filter((p) => p !== fallbackPath)];

           this.logger.info('DIAGNOSTICS', `✅ Fallback successful: Using ${fallbackPath}`);

           return {
             ...this.sessionContext!,
             healthy: true,
             fileCount: files.length,
             message: `⚠️ FALLBACK ACTIVATED: Using Desktop instead. ${files.length} files indexed.`,
             fallbackReason: `Original path unavailable, using Desktop instead`,
           };
        }
      } catch (fallbackError) {
        this.logger.error(
          'DIAGNOSTICS',
          `Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        );
      }

      throw error;
    }
  }

  /**
    * PHASE 2: Intelligent File Resolution
    * Search across multiple locations with fuzzy matching
    */
  async resolveFile(filename: string, _context?: SessionContext): Promise<FileResolution | string> {
    this.logger.info('DIAGNOSTICS', `🔍 Resolving file: ${filename}`);

    // Check exact match first
    for (const searchPath of this.searchPaths) {
      try {
        const fullPath = path.join(searchPath, filename);
        const stats = await fs.promises.stat(fullPath);
        if (stats.isFile()) {
          this.logger.info('DIAGNOSTICS', `✅ EXACT MATCH: ${fullPath}`);
          if (this.sessionContext) {
            this.sessionContext.discoveredPaths.set(filename, fullPath);
          }
          return {
            success: true,
            found: true,
            fullPath,
            directory: searchPath,
            matchQuality: 'exact',
            message: `✅ FILE FOUND: ${fullPath}`,
          };
        }
      } catch (e) {
        // Continue searching
      }
    }

    // Fuzzy match: search for partial filename matches
    this.logger.info('DIAGNOSTICS', `Attempting fuzzy match for: ${filename}`);

    for (const searchPath of this.searchPaths) {
      try {
        const files = await fs.promises.readdir(searchPath, { recursive: true });
        const normalizedSearch = filename.toLowerCase();

        // Find best match
        let bestMatch: string | null = null;
        let bestScore = 0;

        for (const file of files) {
          const normalizedFile = file.toLowerCase();

          // Score calculation
          let score = 0;
          if (normalizedFile.includes(normalizedSearch)) {
            score = normalizedSearch.length / normalizedFile.length;
          }

          // Boost score if extension matches
          const searchExt = path.extname(filename).toLowerCase();
          if (searchExt && normalizedFile.endsWith(searchExt)) {
            score += 0.5;
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = file;
          }
        }

        if (bestMatch && bestScore > 0.4) {
          const fullPath = path.join(searchPath, bestMatch);
          this.logger.info('DIAGNOSTICS', `✅ FUZZY MATCH (${(bestScore * 100).toFixed(0)}%): ${fullPath}`);

          if (this.sessionContext) {
            this.sessionContext.discoveredPaths.set(filename, fullPath);
          }

          return {
            success: true,
            found: true,
            fullPath,
            directory: searchPath,
            matchQuality: 'fuzzy',
            message: `✅ FILE FOUND (fuzzy match): ${fullPath}`,
          };
        }
      } catch (e) {
        // Continue to next path
      }
    }

    // No match found - suggest alternatives
    this.logger.warn('DIAGNOSTICS', `❌ No match found for: ${filename}`);

    const suggestions = await this.getSuggestionsForFile(filename);

    return {
      success: false,
      found: false,
      matchQuality: 'none',
      message: `❌ FILE NOT FOUND: ${filename}. Searched ${this.searchPaths.length} locations.`,
      suggestions,
    };
  }

  /**
   * PHASE 3: Get current directory context
   */
  getCurrentContext(): SessionContext | null {
    return this.sessionContext;
  }

  /**
   * Update scope path and rebuild cache
   */
  async updateScopePath(newPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(newPath);
      if (!stats.isDirectory()) {
        this.logger.warn('DIAGNOSTICS', `${newPath} is not a directory`);
        return false;
      }

      const files = await fs.promises.readdir(newPath);
      const dirTree = await this.buildDirectoryTree(newPath, 3);

      if (this.sessionContext) {
        this.sessionContext.scopePath = newPath;
        this.sessionContext.fileCache = files;
        this.sessionContext.directoryStructure = dirTree;
        this.sessionContext.timestamps.lastUpdate = Date.now();
        this.sessionContext.discoveredPaths.clear();
      }

      // Update search paths
      this.searchPaths = [newPath, ...this.searchPaths.filter((p) => p !== newPath)];

      this.logger.info('DIAGNOSTICS', `✅ Scope updated to: ${newPath} (${files.length} items)`);

      return true;
    } catch (error) {
      this.logger.error(
        'DIAGNOSTICS',
        `Failed to update scope: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Build directory tree recursively
   */
  private async buildDirectoryTree(
    dirPath: string,
    maxDepth: number,
    currentDepth: number = 0
  ): Promise<DirectoryTree> {
    const name = path.basename(dirPath) || dirPath;

    if (currentDepth >= maxDepth) {
      return {
        name,
        path: dirPath,
        type: 'dir',
        children: [],
      };
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const children: DirectoryTree[] = [];

      for (const entry of entries) {
        try {
          const entryPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.')) {
              const subTree = await this.buildDirectoryTree(entryPath, maxDepth, currentDepth + 1);
              children.push(subTree);
            }
          } else {
            children.push({
              name: entry.name,
              path: entryPath,
              type: 'file',
            });
          }
        } catch (e) {
          // Skip inaccessible entries
        }
      }

      return {
        name,
        path: dirPath,
        type: 'dir',
        children,
      };
    } catch (error) {
      return {
        name,
        path: dirPath,
        type: 'dir',
        children: [],
      };
    }
  }

  /**
   * Cache all files for quick lookup
   */
  private async cacheAllFiles(dirPath: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dirPath, { recursive: true });

      if (this.sessionContext) {
        for (const file of files) {
          const filename = path.basename(file);
          const fullPath = path.join(dirPath, file);
          this.sessionContext.discoveredPaths.set(filename, fullPath);
        }
      }
    } catch (error) {
      this.logger.warn('DIAGNOSTICS', `Failed to cache files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get suggestions for a file not found
   */
  private async getSuggestionsForFile(filename: string): Promise<string[]> {
    const suggestions: string[] = [];

    try {
      const ext = path.extname(filename);
      const baseName = path.basename(filename, ext);

      // Search for files with same extension
      if (this.sessionContext) {
        for (const [cached, fullPath] of this.sessionContext.discoveredPaths) {
          if (cached.endsWith(ext) && cached.includes(baseName.slice(0, 3))) {
            suggestions.push(fullPath);
            if (suggestions.length >= 5) break;
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }

    return suggestions;
  }

  /**
   * Generate diagnostic report
   */
  getStatus(): string {
    if (!this.sessionContext) {
      return '⚠️ DIAGNOSTICS: Not initialized';
    }

    return `
🔧 DIAGNOSTIC STATUS:
  Scope: ${this.sessionContext.scopePath}
  Files indexed: ${this.sessionContext.fileCache.length}
  Discovered paths: ${this.sessionContext.discoveredPaths.size}
  Search paths: ${this.searchPaths.length}
  Health: HEALTHY ✅
    `;
  }
}

export default AutonomousDiagnosticsSystem;
