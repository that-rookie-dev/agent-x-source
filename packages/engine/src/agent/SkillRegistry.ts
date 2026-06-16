import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillDefinition {
  name: string;
  description: string;
  trigger: string;
  prompt: string;
  tools: string[];
  category: string;
}

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    this.loadFromDisk();
  }

  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillDefinition | undefined { return this.skills.get(name); }

  list(): SkillDefinition[] { return [...this.skills.values()]; }

  findByTrigger(input: string): SkillDefinition[] {
    const lower = input.toLowerCase();
    return this.list().filter(s => lower.includes(s.trigger.toLowerCase()));
  }

  private loadFromDisk(): void {
    if (!existsSync(this.skillsDir)) return;
    const files = readdirSync(this.skillsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const skill = JSON.parse(readFileSync(join(this.skillsDir, file), 'utf-8')) as SkillDefinition;
        this.skills.set(skill.name, skill);
      } catch { /* skip invalid */ }
    }
  }
}
