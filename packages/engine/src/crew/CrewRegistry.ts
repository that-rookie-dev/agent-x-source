import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Crew } from '@agentx/shared';
import { getConfigDir } from '@agentx/shared';

export interface RegistryEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  tags: string[];
  downloadCount: number;
  crew: Crew;
}

export class CrewRegistry {
  private entries: RegistryEntry[] = [];
  private registryPath: string;

  constructor() {
    const configDir = getConfigDir();
    this.registryPath = join(configDir, 'crew-registry.json');
    this.load();
  }

  private load(): void {
    if (existsSync(this.registryPath)) {
      try {
        const raw = readFileSync(this.registryPath, 'utf-8');
        this.entries = JSON.parse(raw) as RegistryEntry[];
      } catch { this.entries = []; }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(this.entries, null, 2));
  }

  list(): RegistryEntry[] { return [...this.entries]; }

  get(id: string): RegistryEntry | undefined { return this.entries.find(e => e.id === id); }

  search(query: string): RegistryEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter(e =>
      e.name.toLowerCase().includes(lower) ||
      e.description.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  publish(entry: Omit<RegistryEntry, 'downloadCount'>): void {
    const existing = this.entries.findIndex(e => e.id === entry.id);
    const newEntry: RegistryEntry = { ...entry, downloadCount: 0 };
    if (existing >= 0) {
      this.entries[existing] = { ...newEntry, downloadCount: this.entries[existing]!.downloadCount };
    } else {
      this.entries.push(newEntry);
    }
    this.save();
  }

  remove(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx < 0) return false;
    this.entries.splice(idx, 1);
    this.save();
    return true;
  }

  incrementDownloads(id: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (entry) { entry.downloadCount++; this.save(); }
  }
}
