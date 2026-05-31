import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getLogger } from '@agentx/shared';
import type { Agent } from './Agent.js';
import { findBundledSkill, getBundledSkills } from './BundledSkills.js';

const logger = getLogger();

export interface GeneratedSkill {
  id: string;
  name: string;
  description: string;
  triggerPatterns: string[];
  prompt: string;
  tools: string[];
  createdAt: string;
  usageCount: number;
}

/**
 * Automatically generates reusable skills when the agent
 * solves a novel problem successfully.
 */
export class SkillGenerator {
  private skillsDir: string;
  private skills: Map<string, GeneratedSkill> = new Map();

  constructor() {
    this.skillsDir = join(homedir(), '.config', 'agentx', 'skills');
    this.ensureDir();
    this.loadSkills();
  }

  private ensureDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  private loadSkills(): void {
    try {
      const files = readdirSync(this.skillsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = JSON.parse(readFileSync(join(this.skillsDir, file), 'utf-8')) as GeneratedSkill;
          this.skills.set(content.id, content);
        } catch { /* skip malformed */ }
      }
      logger.info('SKILL_GEN', `Loaded ${this.skills.size} skills from disk`);
    } catch {
      // directory doesn't exist yet
    }
  }

  /**
   * Check if a task is novel enough to warrant skill generation.
   * Novelty criteria:
   * - Task required 3+ tool calls
   * - Task used at least 2 different tool categories
   * - No existing skill matches the task description
   */
  shouldGenerateSkill(instruction: string, toolCallsUsed: Array<{ name: string }>): boolean {
    if (toolCallsUsed.length < 3) return false;

    const uniqueCategories = new Set(
      toolCallsUsed.map((t) => {
        const name = t.name;
        if (name.startsWith('file_') || name.startsWith('folder_')) return 'filesystem';
        if (name.startsWith('git_')) return 'git';
        if (name.startsWith('code_') || name === 'file_patch') return 'code';
        if (name.startsWith('shell_') || name.startsWith('process_')) return 'shell';
        if (name.startsWith('test_')) return 'testing';
        if (name.startsWith('web_') || name.startsWith('http_')) return 'web';
        if (name.startsWith('container_') || name.startsWith('docker_')) return 'containers';
        return 'other';
      }),
    );

    if (uniqueCategories.size < 2) return false;

    // Check if similar skill already exists
    const lower = instruction.toLowerCase();
    for (const [, skill] of this.skills) {
      const similarity = this.computeSimilarity(lower, skill.description.toLowerCase());
      if (similarity > 0.7) return false;
    }

    return true;
  }

  /**
   * Generate a reusable skill from a successfully completed task.
   */
  async generateSkill(
    agent: Agent,
    instruction: string,
    toolCallsUsed: Array<{ name: string; args: Record<string, unknown> }>,
    result: string,
  ): Promise<GeneratedSkill | null> {
    const id = `skill-${Date.now()}`;
    const toolsUsed = [...new Set(toolCallsUsed.map((t) => t.name))];

    // Generate skill name and description from the instruction
    const namePrompt = `Given this task that was successfully completed, create a SHORT skill name (2-5 words) that describes the capability:
Instruction: "${instruction.slice(0, 200)}"
Skill name:`;

    const descPrompt = `Based on this task, write a 1-sentence description of what the skill does:
Instruction: "${instruction.slice(0, 200)}"
Tools used: ${toolsUsed.join(', ')}
Description:`;

    try {
      // Get skill name from provider
      let skillName = '';
      let skillDesc = '';

      const prov = (agent as unknown as { provider: { complete: (req: unknown) => AsyncIterable<Record<string, unknown>> } }).provider;
      if (prov) {
        const nameStream = prov.complete({
          messages: [{ role: 'user', content: namePrompt }],
          model: (agent as unknown as { config: { provider: { activeModel: string } } }).config?.provider?.activeModel ?? 'gpt-4o-mini',
          maxTokens: 50,
          stream: true,
        });
        for await (const chunk of nameStream) {
          if (chunk.type === 'text_delta' && chunk.content) skillName += String(chunk.content);
        }

        const descStream = prov.complete({
          messages: [{ role: 'user', content: descPrompt }],
          model: (agent as unknown as { config: { provider: { activeModel: string } } }).config?.provider?.activeModel ?? 'gpt-4o-mini',
          maxTokens: 100,
          stream: true,
        });
        for await (const chunk of descStream) {
          if (chunk.type === 'text_delta' && chunk.content) skillDesc += String(chunk.content);
        }
      }

      skillName = (skillName || 'Custom Skill').trim().replace(/^["']|["']$/g, '');
      skillDesc = (skillDesc || instruction.slice(0, 150)).trim().replace(/^["']|["']$/g, '');

      // Generate trigger patterns
      const triggerPatterns = this.generateTriggers(instruction);

      const skill: GeneratedSkill = {
        id,
        name: skillName,
        description: skillDesc,
        triggerPatterns,
        prompt: this.buildSkillPrompt(instruction, toolCallsUsed, result),
        tools: toolsUsed,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      };

      // Save to disk
      const filePath = join(this.skillsDir, `${id}.json`);
      writeFileSync(filePath, JSON.stringify(skill, null, 2));
      this.skills.set(id, skill);

      logger.info('SKILL_GEN', `Generated skill: ${skillName} (${id})`);
      return skill;
    } catch (e) {
      logger.warn('SKILL_GEN', `Failed to generate skill: ${e}`);
      return null;
    }
  }

  /**
   * Get all loaded skills.
   */
  getAll(): GeneratedSkill[] {
    // Merge generated + bundled skills, remove duplicates by id
    const bundled = getBundledSkills();
    const generated = [...this.skills.values()];
    const all = new Map<string, GeneratedSkill>();
    for (const s of bundled) all.set(s.id, s);
    for (const s of generated) all.set(s.id, s);
    return [...all.values()].sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Find the best matching skill for a user query.
   */
  findBestMatch(query: string): GeneratedSkill | null {
    // First check generated skills
    let best: GeneratedSkill | null = null;
    let bestScore = 0;
    const lower = query.toLowerCase();

    for (const [, skill] of this.skills) {
      for (const pattern of skill.triggerPatterns) {
        const score = this.computeSimilarity(lower, pattern.toLowerCase());
        if (score > bestScore) {
          bestScore = score;
          best = skill;
        }
      }
    }

    // If no generated skill matches, fall back to bundled skills
    if (!best || bestScore < 0.5) {
      const bundled = findBundledSkill(query);
      if (bundled && (!best || bestScore < 0.4)) {
        best = bundled;
        bestScore = 0.6; // bundled skills get a default confidence boost
      }
    }

    return bestScore > 0.4 ? best : null;
  }

  /**
   * Record usage of a skill.
   */
  recordUsage(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.usageCount++;
      const filePath = join(this.skillsDir, `${skillId}.json`);
      try { writeFileSync(filePath, JSON.stringify(skill, null, 2)); } catch { /* ignore */ }
    }
  }

  private generateTriggers(instruction: string): string[] {
    const words = instruction.toLowerCase().split(/\s+/);
    const keyPhrases: string[] = [];

    // Extract 2-3 word phrases
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = words.slice(i, i + 2).join(' ');
      if (phrase.length > 5 && !keyPhrases.includes(phrase)) {
        keyPhrases.push(phrase);
      }
    }

    return keyPhrases.slice(0, 5);
  }

  private buildSkillPrompt(
    instruction: string,
    toolCallsUsed: Array<{ name: string; args: Record<string, unknown> }>,
    result: string,
  ): string {
    const steps = toolCallsUsed.map((tc, i) => `${i + 1}. ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})`);

    return `[SKILL: ${instruction.slice(0, 100)}]
Steps:
${steps.join('\n')}

Expected outcome:
${result.slice(0, 500)}

Apply this pattern when the user requests similar work. Follow the same sequence of tool calls, adapting parameters as needed.`;
  }

  private computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let matchCount = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) matchCount++;
      else {
        // Check for partial match (e.g., "deploy" matches "deploying")
        for (const wb of wordsB) {
          if (wb.includes(w) || w.includes(wb)) { matchCount += 0.5; break; }
        }
      }
    }

    return matchCount / Math.max(wordsA.size, wordsB.size);
  }
}
