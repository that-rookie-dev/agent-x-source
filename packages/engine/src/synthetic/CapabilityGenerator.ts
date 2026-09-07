import { generateId, type Capability, type CapabilityKind, type CapabilityLanguage, type CapabilityMeta, type KnowledgeCapability, type ObservedPattern, type SkillCapability, type ToolCapability } from '@agentx/shared';
import { CapabilityGenerationError } from './errors.js';
import type { CapabilityGenerator, GenerateFn } from './interfaces.js';
import { extractJsonObject, slugName } from './json.js';

const SKILL_SYSTEM = `You generate reusable prompt-recipe skills for Agent-X.
Return ONLY JSON with keys: name, description, promptTemplate, triggerPattern, exampleCalls (string array).
name: lowercase hyphenated slug. promptTemplate: instructions the agent should follow when the skill applies.
triggerPattern: a simple regex or keyword list. Do not generate executable source code.`;

const TOOL_SYSTEM = `You generate a small, side-effect-aware tool for Agent-X.
Return ONLY JSON with keys: name, description, language, sourceCode, entryPoint, inputSchema, outputSchema, dependencies (string array), sideEffects (string array).
language must be typescript, python, javascript, or bash.
sourceCode must define entryPoint as a function that accepts a single args object and returns JSON-serializable output.
Prefer no network or filesystem writes. List any side effects honestly.`;

const KNOWLEDGE_SYSTEM = `You generate a reusable knowledge item for Agent-X.
Return ONLY JSON with keys: name, description, domain, content, sourceReferences (string array).
name: lowercase hyphenated slug. content: concise but complete summary the agent can inject into context. domain: broad topic label.`;

function nowMeta(partial: {
  kind: CapabilityKind;
  name: string;
  description: string;
  origin: CapabilityMeta['origin'];
  sourceSessionId?: string;
  createdBy?: string;
  userPrompt?: string;
  generatedBy?: string;
}): Omit<CapabilityMeta, 'kind'> & { kind: CapabilityKind } {
  const ts = Date.now();
  return {
    id: generateId('cap'),
    kind: partial.kind,
    name: slugName(partial.name),
    description: partial.description,
    createdAt: ts,
    updatedAt: ts,
    createdBy: partial.createdBy ?? 'system',
    sourceSessionId: partial.sourceSessionId ?? '',
    version: 1,
    origin: partial.origin,
    userPrompt: partial.userPrompt,
    status: 'proposed',
    useCount: 0,
    trialCount: 0,
    generatedBy: partial.generatedBy,
  };
}

function inferKind(prompt: string): CapabilityKind {
  const p = prompt.toLowerCase();
  if (/\b(tool|function|script|code|convert|parse|transform|csv|json|regex)\b/.test(p)) return 'tool';
  if (/\b(knowledge|learn|remember|fact|reference|domain|summary|when asked)\b/.test(p)) return 'knowledge';
  return 'skill';
}

export class DefaultCapabilityGenerator implements CapabilityGenerator {
  constructor(
    private generateFn?: GenerateFn | null,
    private timeoutMs = 45_000,
  ) {}

  private async callLlm(prompt: string, system: string): Promise<string> {
    if (!this.generateFn) throw new CapabilityGenerationError('No generator available');
    return Promise.race([
      this.generateFn(prompt, system),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('LLM timeout')), this.timeoutMs);
      }),
    ]);
  }

  async clarifyUserPrompt(prompt: string): Promise<{ questions: string[]; inferredKind: CapabilityKind | 'auto' }> {
    const inferredKind = inferKind(prompt);
    const questions: string[] = [];
    if (prompt.trim().length < 24) {
      questions.push('What should this capability do, in one or two sentences?');
    }
    if (inferredKind === 'tool' && !/\b(input|output|csv|json|file|args)\b/i.test(prompt)) {
      questions.push('What are the inputs and the expected output shape?');
    }
    if (!/\b(skill|tool|workflow|whenever|when)\b/i.test(prompt)) {
      questions.push('Should this be a prompt-recipe skill (guidance) or an executable tool (deterministic code)?');
    }
    return { questions, inferredKind: questions.length ? 'auto' : inferredKind };
  }

  async generateSkill(pattern: ObservedPattern): Promise<SkillCapability | null> {
    const origin: CapabilityMeta['origin'] = pattern.origin === 'user-prompt' ? 'user-prompt' : 'observed';
    if (this.generateFn) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await this.callLlm(
            `Create a prompt-recipe skill for this repeating need:\n${pattern.pattern}\nContext:\n${pattern.context}`,
            SKILL_SYSTEM,
          );
          const json = extractJsonObject(raw);
          if (!json) continue;
          const name = slugName(String(json['name'] ?? pattern.pattern.slice(0, 32)));
          const trigger = String(json['triggerPattern'] ?? '');
          if (trigger && this.invalidRegex(trigger)) continue;
          return {
            ...nowMeta({
              kind: 'skill',
              name,
              description: String(json['description'] ?? pattern.pattern),
              origin,
              userPrompt: pattern.origin === 'user-prompt' ? pattern.pattern : undefined,
            }),
            kind: 'skill',
            promptTemplate: String(json['promptTemplate'] ?? pattern.pattern),
            triggerPattern: trigger || slugName(pattern.pattern),
            exampleCalls: Array.isArray(json['exampleCalls']) ? json['exampleCalls'].map(String) : [],
          };
        } catch {
          /* retry */
        }
      }
    }
    return this.heuristicSkill(pattern, origin);
  }

  async generateKnowledge(pattern: ObservedPattern): Promise<KnowledgeCapability | null> {
    const origin: CapabilityMeta['origin'] = pattern.origin === 'user-prompt' ? 'user-prompt' : 'observed';
    if (this.generateFn) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await this.callLlm(
            `Create a concise knowledge item for this recurring topic:\n${pattern.pattern}\nContext:\n${pattern.context}`,
            KNOWLEDGE_SYSTEM,
          );
          const json = extractJsonObject(raw);
          if (!json) continue;
          const name = slugName(String(json['name'] ?? pattern.pattern.slice(0, 32)));
          return {
            ...nowMeta({
              kind: 'knowledge',
              name,
              description: String(json['description'] ?? pattern.pattern),
              origin,
              userPrompt: pattern.origin === 'user-prompt' ? pattern.pattern : undefined,
            }),
            kind: 'knowledge',
            domain: String(json['domain'] ?? 'general'),
            content: String(json['content'] ?? pattern.context),
            sourceReferences: Array.isArray(json['sourceReferences']) ? json['sourceReferences'].map(String) : [],
          };
        } catch {
          /* retry */
        }
      }
    }
    return {
      ...nowMeta({
        kind: 'knowledge',
        name: slugName(pattern.pattern.slice(0, 32)),
        description: pattern.pattern,
        origin,
        userPrompt: pattern.origin === 'user-prompt' ? pattern.pattern : undefined,
      }),
      kind: 'knowledge',
      domain: 'general',
      content: pattern.context,
      sourceReferences: [],
    };
  }

  async generateTool(pattern: ObservedPattern): Promise<ToolCapability | null> {
    const origin: CapabilityMeta['origin'] = pattern.origin === 'user-prompt' ? 'user-prompt' : 'observed';
    if (!this.generateFn) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await this.callLlm(
          `Create an executable tool for:\n${pattern.pattern}\nContext:\n${pattern.context}`,
          TOOL_SYSTEM,
        );
        const json = extractJsonObject(raw);
        if (!json || typeof json['sourceCode'] !== 'string') continue;
        const language = this.normalizeLanguage(json['language']);
        const sourceCode = String(json['sourceCode']);
        const tsCheck = this.validateTypeScript(sourceCode);
        if (language === 'typescript' && !tsCheck.valid) continue;
        return {
          ...nowMeta({
            kind: 'tool',
            name: slugName(String(json['name'] ?? pattern.pattern.slice(0, 32))),
            description: String(json['description'] ?? pattern.pattern),
            origin,
            userPrompt: pattern.origin === 'user-prompt' ? pattern.pattern : undefined,
          }),
          kind: 'tool',
          language,
          sourceCode,
          entryPoint: String(json['entryPoint'] ?? 'run'),
          inputSchema: (json['inputSchema'] as Record<string, unknown>) ?? { type: 'object', properties: {} },
          outputSchema: (json['outputSchema'] as Record<string, unknown>) ?? { type: 'object', properties: {} },
          dependencies: Array.isArray(json['dependencies']) ? json['dependencies'].map(String) : [],
          sideEffects: Array.isArray(json['sideEffects']) ? json['sideEffects'].map(String) : this.detectSideEffects(sourceCode, language),
          approvedSideEffects: [],
          sandboxResult: null,
        };
      } catch {
        /* retry */
      }
    }
    return null;
  }

  async generateAlternative(capability: ToolCapability, feedback: string): Promise<ToolCapability> {
    if (!this.generateFn) {
      throw new CapabilityGenerationError('No generator available for alternatives');
    }
    const raw = await this.callLlm(
      `Improve this tool.\nFeedback: ${feedback}\nExisting source:\n${capability.sourceCode}`,
      TOOL_SYSTEM,
    );
    const json = extractJsonObject(raw);
    if (!json || typeof json['sourceCode'] !== 'string') {
      throw new CapabilityGenerationError('Alternative generation returned invalid JSON');
    }
    return {
      ...capability,
      version: capability.version + 1,
      updatedAt: Date.now(),
      sourceCode: String(json['sourceCode']),
      description: String(json['description'] ?? capability.description),
      entryPoint: String(json['entryPoint'] ?? capability.entryPoint),
    };
  }

  async proposeEnhancement(existing: CapabilityMeta, context: string): Promise<Capability | null> {
    if (existing.kind !== 'skill' && existing.kind !== 'tool') return null;
    const pattern: ObservedPattern = {
      id: generateId('obs'),
      pattern: `Enhance ${existing.name}: ${context}`,
      frequency: 1,
      firstObservedAt: Date.now(),
      lastObservedAt: Date.now(),
      context,
      confidence: 0.6,
      origin: 'autonomous',
    };
    if (existing.kind === 'skill') return this.generateSkill(pattern);
    return this.generateTool(pattern);
  }

  validateTypeScript(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const opens = (code.match(/{/g) ?? []).length;
    const closes = (code.match(/}/g) ?? []).length;
    if (opens !== closes) errors.push('unbalanced braces');
    if (!code.trim()) errors.push('empty source');
    return { valid: errors.length === 0, errors };
  }

  validatePython(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!code.trim()) errors.push('empty source');
    if (/^\s*(import os|subprocess|eval\()/m.test(code)) errors.push('dangerous import');
    return { valid: errors.length === 0, errors };
  }

  validateBash(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!code.trim()) errors.push('empty source');
    if (/rm\s+-rf\s+\//.test(code)) errors.push('destructive command');
    return { valid: errors.length === 0, errors };
  }

  detectSideEffects(code: string, _language: string): string[] {
    const found: string[] = [];
    if (/fetch\(|http\.|axios|requests\.|curl |net\.connect|WebSocket/.test(code)) found.push('network');
    if (/writeFile|open\(.+['"]w|fs\.write|unlinkSync|rmSync/.test(code)) found.push('filesystem:write');
    if (/process\.env|os\.environ/.test(code)) found.push('env');
    if (/child_process|spawn\(|exec\(|execSync|fork\(/.test(code)) found.push('subprocess');
    if (/\beval\s*\(|new Function\s*\(/.test(code)) found.push('eval');
    return found;
  }

  estimateRisk(code: string, language: string): 'low' | 'medium' | 'high' {
    const effects = this.detectSideEffects(code, language);
    if (effects.includes('network') || effects.includes('filesystem:write') || effects.includes('subprocess') || effects.includes('eval')) {
      return 'high';
    }
    if (effects.length >= 3) return 'high';
    if (effects.length) return 'medium';
    return 'low';
  }

  private heuristicSkill(pattern: ObservedPattern, origin: CapabilityMeta['origin']): SkillCapability {
    return {
      ...nowMeta({
        kind: 'skill',
        name: slugName(pattern.pattern),
        description: pattern.pattern.slice(0, 240),
        origin,
        userPrompt: origin === 'user-prompt' ? pattern.pattern : undefined,
      }),
      kind: 'skill',
      promptTemplate: pattern.pattern,
      triggerPattern: slugName(pattern.pattern).replace(/-/g, '|'),
      exampleCalls: [],
    };
  }

  private invalidRegex(value: string): boolean {
    try {
      new RegExp(value);
      return false;
    } catch {
      return true;
    }
  }

  private normalizeLanguage(raw: unknown): CapabilityLanguage {
    const v = String(raw ?? 'typescript').toLowerCase();
    if (v === 'python' || v === 'bash' || v === 'javascript' || v === 'typescript') return v;
    return 'typescript';
  }
}
