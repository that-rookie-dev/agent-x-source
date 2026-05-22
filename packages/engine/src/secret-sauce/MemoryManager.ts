import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  timestamp: string;
  relevance: number;
}

export class MemoryManager {
  private memories: MemoryEntry[] = [];
  private secretSauceDir: string;
  private maxMemories = 100;
  private windowDays = 30;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.load();
  }

  private load(): void {
    const memPath = join(this.secretSauceDir, 'memories.json');
    if (existsSync(memPath)) {
      try {
        this.memories = JSON.parse(readFileSync(memPath, 'utf-8')) as MemoryEntry[];
      } catch {
        this.memories = [];
      }
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    writeFileSync(
      join(this.secretSauceDir, 'memories.json'),
      JSON.stringify(this.memories, null, 2),
    );
  }

  addMemory(content: string, category: string): void {
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      category,
      timestamp: new Date().toISOString(),
      relevance: 1.0,
    };
    this.memories.push(entry);

    // Prune old entries beyond window
    this.prune();
    this.save();
  }

  private prune(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.windowDays);
    const cutoffStr = cutoff.toISOString();

    this.memories = this.memories
      .filter((m) => m.timestamp >= cutoffStr)
      .slice(-this.maxMemories);
  }

  getRecentMemories(limit = 20): MemoryEntry[] {
    return this.memories
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  searchMemories(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return this.memories.filter(
      (m) => m.content.toLowerCase().includes(lower) || m.category.toLowerCase().includes(lower),
    );
  }

  buildContext(tokenBudget = 2000): string {
    const recent = this.getRecentMemories(10);
    if (recent.length === 0) return '';

    let context = '[MEMORIES]\n';
    let estimated = 20;

    for (const mem of recent) {
      const line = `- [${mem.category}] ${mem.content}\n`;
      const lineTokens = Math.ceil(line.length / 4);
      if (estimated + lineTokens > tokenBudget) break;
      context += line;
      estimated += lineTokens;
    }

    context += '[/MEMORIES]';
    return context;
  }

  getCount(): number {
    return this.memories.length;
  }
}
