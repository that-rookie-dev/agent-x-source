import type { SkillCapability } from '@agentx/shared';
import type { CapabilityStore } from './interfaces.js';

export class SkillActivator {
  constructor(private store: CapabilityStore) {}

  async matchingSkills(message: string): Promise<SkillCapability[]> {
    const skills = await this.store.getCapabilities('registered', 'skill', 80, 0);
    const text = message.trim();
    if (!text) return [];
    const matched: SkillCapability[] = [];
    for (const cap of skills) {
      if (cap.kind !== 'skill') continue;
      if (this.matches(text, cap.triggerPattern)) matched.push(cap);
    }
    return matched;
  }

  async activateForMessage(message: string): Promise<string | null> {
    const matched = await this.matchingSkills(message);
    if (!matched.length) return null;
    const blocks = matched.map((skill) =>
      `[ACTIVE SKILL: ${skill.name}]\n${skill.promptTemplate}\nThis is a Synthetic Intelligence prompt-recipe skill, not an Executable Skill package.\n[/ACTIVE SKILL]`,
    );
    return blocks.join('\n\n');
  }

  private matches(message: string, triggerPattern: string): boolean {
    const pattern = triggerPattern.trim();
    if (!pattern) return false;
    try {
      return new RegExp(pattern, 'i').test(message);
    } catch {
      return message.toLowerCase().includes(pattern.toLowerCase());
    }
  }
}
