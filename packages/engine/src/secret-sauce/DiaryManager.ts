import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

interface DiaryEntry {
  date: string;
  summary: string;
  sessionsCount: number;
  highlights: string[];
  insights: string[];
}

export class DiaryManager {
  private entries: DiaryEntry[] = [];
  private secretSauceDir: string;
  private maxEntries = 90; // ~3 months

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.load();
  }

  private load(): void {
    const diaryPath = join(this.secretSauceDir, 'diary.json');
    if (existsSync(diaryPath)) {
      try {
        this.entries = JSON.parse(readFileSync(diaryPath, 'utf-8')) as DiaryEntry[];
      } catch {
        this.entries = [];
      }
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    writeFileSync(
      join(this.secretSauceDir, 'diary.json'),
      JSON.stringify(this.entries, null, 2),
    );
  }

  addEntry(summary: string, sessionsCount: number, highlights: string[], insights: string[]): void {
    const today = new Date().toISOString().split('T')[0]!;
    const existing = this.entries.findIndex((e) => e.date === today);

    const entry: DiaryEntry = { date: today, summary, sessionsCount, highlights, insights };

    if (existing >= 0) {
      this.entries[existing] = entry;
    } else {
      this.entries.push(entry);
    }

    // Keep within limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    this.save();
  }

  getToday(): DiaryEntry | undefined {
    const today = new Date().toISOString().split('T')[0]!;
    return this.entries.find((e) => e.date === today);
  }

  getRecent(days = 7): DiaryEntry[] {
    return this.entries.slice(-days);
  }

  buildContext(): string {
    const recent = this.getRecent(3);
    if (recent.length === 0) return '';

    let context = '[DIARY]\n';
    for (const entry of recent) {
      context += `## ${entry.date}\n`;
      context += `${entry.summary}\n`;
      if (entry.highlights.length > 0) {
        context += `Highlights: ${entry.highlights.join(', ')}\n`;
      }
      context += '\n';
    }
    context += '[/DIARY]';
    return context;
  }

  getEntryCount(): number {
    return this.entries.length;
  }
}
