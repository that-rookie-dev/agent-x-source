import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSecretSauceDir } from '../config/paths.js';

interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  timestamp: string;
  relevance: number;
}

/** Categories that are global (shared across all crews) */
const GLOBAL_CATEGORIES = new Set(['identity', 'preference']);

export class MemoryManager {
  private globalMemories: MemoryEntry[] = [];
  private crewMemories: MemoryEntry[] = [];
  private secretSauceDir: string;
  private crewId: string;
  private maxMemories = 100;
  private windowDays = 30;

  constructor(crewId = 'default') {
    this.secretSauceDir = getSecretSauceDir();
    this.crewId = crewId;
    this.loadGlobal();
    this.loadCrew();
  }

  private getGlobalPath(): string {
    return join(this.secretSauceDir, 'global', 'memories.json');
  }

  private getCrewPath(): string {
    return join(this.secretSauceDir, 'crews', this.crewId, 'memories.json');
  }

  private loadGlobal(): void {
    const memPath = this.getGlobalPath();
    if (existsSync(memPath)) {
      try {
        this.globalMemories = JSON.parse(readFileSync(memPath, 'utf-8')) as MemoryEntry[];
      } catch {
        this.globalMemories = [];
      }
    }
  }

  private loadCrew(): void {
    const memPath = this.getCrewPath();
    if (existsSync(memPath)) {
      try {
        this.crewMemories = JSON.parse(readFileSync(memPath, 'utf-8')) as MemoryEntry[];
      } catch {
        this.crewMemories = [];
      }
    }
  }

  private saveGlobal(): void {
    const dir = join(this.secretSauceDir, 'global');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.getGlobalPath(), JSON.stringify(this.globalMemories, null, 2));
  }

  private saveCrew(): void {
    const dir = join(this.secretSauceDir, 'crews', this.crewId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.getCrewPath(), JSON.stringify(this.crewMemories, null, 2));
  }

  addMemory(content: string, category: string): void {
    const entry: MemoryEntry = {
      id: randomUUID(),
      content,
      category,
      timestamp: new Date().toISOString(),
      relevance: 1.0,
    };

    if (GLOBAL_CATEGORIES.has(category)) {
      this.globalMemories.push(entry);
      this.pruneList(this.globalMemories);
      this.saveGlobal();
    } else {
      this.crewMemories.push(entry);
      this.pruneList(this.crewMemories);
      this.saveCrew();
    }
  }

  private pruneList(list: MemoryEntry[]): MemoryEntry[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.windowDays);
    const cutoffStr = cutoff.toISOString();

    const pruned = list
      .filter((m) => m.timestamp >= cutoffStr)
      .slice(-this.maxMemories);

    list.length = 0;
    list.push(...pruned);
    return list;
  }

  getRecentMemories(limit = 20): MemoryEntry[] {
    return [...this.globalMemories, ...this.crewMemories]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getGlobalMemories(limit = 10): MemoryEntry[] {
    return this.globalMemories
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getCrewMemories(limit = 10): MemoryEntry[] {
    return this.crewMemories
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  searchMemories(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return [...this.globalMemories, ...this.crewMemories].filter(
      (m) => m.content.toLowerCase().includes(lower) || m.category.toLowerCase().includes(lower),
    );
  }

  /**
   * Build context for system prompt.
   * Global memories = user identity/preferences (shared).
   * Crew memories = domain-specific knowledge for this crew.
   */
  buildContext(tokenBudget = 2000): { global: string; crew: string } {
    const globalCtx = this.buildSection(this.getGlobalMemories(10), 'USER_CONTEXT', Math.floor(tokenBudget * 0.4));
    const crewCtx = this.buildSection(this.getCrewMemories(10), 'CREW_MEMORIES', Math.floor(tokenBudget * 0.6));
    return { global: globalCtx, crew: crewCtx };
  }

  private buildSection(entries: MemoryEntry[], tag: string, budget: number): string {
    if (entries.length === 0) return '';

    let context = `[${tag}]\n`;
    let estimated = 20;

    for (const mem of entries) {
      const line = `- [${mem.category}] ${mem.content}\n`;
      const lineTokens = Math.ceil(line.length / 4);
      if (estimated + lineTokens > budget) break;
      context += line;
      estimated += lineTokens;
    }

    context += `[/${tag}]`;
    return context;
  }

  getCount(): number {
    return this.globalMemories.length + this.crewMemories.length;
  }

  /**
   * Migrate legacy flat memories.json into the new structure.
   */
  static migrateIfNeeded(crewId: string): void {
    const sauceDir = getSecretSauceDir();
    const legacyPath = join(sauceDir, 'memories.json');
    if (!existsSync(legacyPath)) return;

    try {
      const entries = JSON.parse(readFileSync(legacyPath, 'utf-8')) as MemoryEntry[];
      const globalDir = join(sauceDir, 'global');
      const crewDir = join(sauceDir, 'crews', crewId);
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(crewDir, { recursive: true });

      const globalEntries = entries.filter((m) => GLOBAL_CATEGORIES.has(m.category));
      const crewEntries = entries.filter((m) => !GLOBAL_CATEGORIES.has(m.category));

      writeFileSync(join(globalDir, 'memories.json'), JSON.stringify(globalEntries, null, 2));
      writeFileSync(join(crewDir, 'memories.json'), JSON.stringify(crewEntries, null, 2));

      // Remove legacy file after successful migration
      unlinkSync(legacyPath);
    } catch {
      // Migration is best-effort
    }
  }
}
