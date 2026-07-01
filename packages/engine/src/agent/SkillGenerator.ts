import { getLogger } from '@agentx/shared';
import type { Agent } from './Agent.js';
import { findBundledSkill, getBundledSkills, BUNDLED_SKILLS } from './BundledSkills.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

interface SkillRow {
  id: string;
  name: string;
  description: string;
  trigger_patterns_json: string;
  prompt: string;
  tools_json: string;
  is_bundled: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface DbLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * Automatically generates reusable skills when the agent
 * solves a novel problem successfully.
 *
 * Skills are persisted in the `skills` database table.
 */
export class SkillGenerator {
  private db: DbLike;
  private skills: Map<string, GeneratedSkill> = new Map();
  private loadPromise: Promise<void>;

  constructor(db: any) {
    this.db = db as DbLike;
    this.loadPromise = this.loadAll();
  }

  private async loadAll(): Promise<void> {
    try {
      const res = await this.db.query('SELECT * FROM skills');
      const rows = (res.rows ?? []) as SkillRow[];
      for (const row of rows) {
        const skill: GeneratedSkill = {
          id: row.id,
          name: row.name,
          description: row.description,
          triggerPatterns: JSON.parse(row.trigger_patterns_json || '[]'),
          prompt: row.prompt,
          tools: JSON.parse(row.tools_json || '[]'),
          createdAt: row.created_at,
          usageCount: row.usage_count,
        };
        this.skills.set(skill.id, skill);
      }
    } catch {
      // table may not exist yet
    }

    // If empty, seed bundled skills into DB
    if (this.skills.size === 0) {
      try {
        const now = new Date().toISOString();
        for (const skill of BUNDLED_SKILLS) {
          await this.db.query(
            `INSERT INTO skills (id, name, description, trigger_patterns_json, prompt, tools_json, is_bundled, usage_count, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 1, 0, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [
              skill.id,
              skill.name,
              skill.description,
              JSON.stringify(skill.triggerPatterns),
              skill.prompt,
              JSON.stringify(skill.tools),
              now,
              now,
            ],
          );
          this.skills.set(skill.id, { ...skill, usageCount: 0 });
        }
        logger.info('SKILL_GEN', `Seeded ${BUNDLED_SKILLS.length} bundled skills`);
      } catch {
        // table may not exist yet — bundled skills will be served from memory via getAll()
      }
    }

    logger.info('SKILL_GEN', `Loaded ${this.skills.size} skills from DB`);
  }

  private async ensureLoaded(): Promise<void> {
    await this.loadPromise;
  }

  /**
   * Check if a task is novel enough to warrant skill generation.
   * Novelty criteria:
   * - Task required 3+ tool calls
   * - Task used at least 2 different tool categories
   * - No existing skill matches the task description
   */
  shouldGenerateSkill(instruction: string, toolCallsUsed: Array<{ name: string }>): boolean {
    this.ensureLoaded();
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
    await this.ensureLoaded();
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

      // Write to DB
      await this.db.query(
        `INSERT INTO skills (id, name, description, trigger_patterns_json, prompt, tools_json, is_bundled, usage_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           trigger_patterns_json = EXCLUDED.trigger_patterns_json,
           prompt = EXCLUDED.prompt,
           tools_json = EXCLUDED.tools_json,
           is_bundled = EXCLUDED.is_bundled,
           usage_count = EXCLUDED.usage_count,
           updated_at = EXCLUDED.updated_at`,
        [
          skill.id,
          skill.name,
          skill.description,
          JSON.stringify(skill.triggerPatterns),
          skill.prompt,
          JSON.stringify(skill.tools),
          skill.createdAt,
          new Date().toISOString(),
        ],
      );
      this.skills.set(id, skill);

      logger.info('SKILL_GEN', `Generated skill: ${skillName} (${id})`);
      return skill;
    } catch (e) {
      logger.warn('SKILL_GEN', `Failed to generate skill: ${e}`);
      return null;
    }
  }

  /**
   * Get all loaded skills. Synchronous — returns whatever is currently in memory.
   * The constructor starts an async load; skills will appear once that completes.
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
   * Find the best matching skill for a user query. Synchronous.
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
  async recordUsage(skillId: string): Promise<void> {
    await this.ensureLoaded();
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.usageCount++;
      try {
        await this.db.query('UPDATE skills SET usage_count = $1, updated_at = $2 WHERE id = $3', [
          skill.usageCount,
          new Date().toISOString(),
          skillId,
        ]);
      } catch {
        /* ignore */
      }
    }
  }

  private generateTriggers(instruction: string): string[] {
    const words = instruction.toLowerCase().split(/\s+/);
    const keyPhrases: string[] = [];

    // Extract 2-3 word phrases
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = words.slice(i, i + 2).join(' ');
      if (phrase.length > 5) keyPhrases.push(phrase);
      if (i < words.length - 2) {
        const phrase3 = words.slice(i, i + 3).join(' ');
        if (phrase3.length > 8) keyPhrases.push(phrase3);
      }
    }

    // Add individual action words
    const actionWords = ['create', 'build', 'fix', 'refactor', 'test', 'deploy', 'analyze', 'generate', 'write', 'update', 'delete', 'implement', 'configure'];
    for (const word of words) {
      if (actionWords.includes(word) && !keyPhrases.includes(word)) {
        keyPhrases.push(word);
      }
    }

    // Remove duplicates and limit
    return [...new Set(keyPhrases)].slice(0, 8);
  }

  private buildSkillPrompt(
    instruction: string,
    toolCallsUsed: Array<{ name: string; args: Record<string, unknown> }>,
    result: string,
  ): string {
    const toolsList = toolCallsUsed.map((t) => `- ${t.name}: ${JSON.stringify(t.args)}`).join('\n');
    return `You are an expert at the following task. Execute it carefully.

Task: ${instruction}

Approach (based on a successful previous execution):
${toolsList}

Expected outcome: ${result.slice(0, 500)}`;
  }

  private computeSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    const aWords = new Set(a.split(/\s+/));
    const bWords = new Set(b.split(/\s+/));
    const intersection = new Set([...aWords].filter((x) => bWords.has(x)));
    const union = new Set([...aWords, ...bWords]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}

/**
 * Load skill files from the filesystem.
 * Each .skill file is a JSON file containing a GeneratedSkill object.
 */
export function loadSkillFiles(skillDir?: string): GeneratedSkill[] {
  const dir = skillDir ?? join(process.cwd(), 'skills');
  if (!existsSync(dir)) return [];

  const skills: GeneratedSkill[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.skill')) continue;
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const skill = JSON.parse(content) as GeneratedSkill;
      skills.push(skill);
    } catch (e) {
      logger.warn('SKILL_GEN', `Failed to load skill file ${file}: ${e}`);
    }
  }
  return skills;
}
