import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile } from '@agentx/shared';
import { getSecretSauceDir } from '../config/paths.js';

const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'general',
    name: 'General Assistant',
    description: 'Versatile AI assistant with broad knowledge across technology, business, and creative domains.',
    systemPrompt: 'You are a versatile, highly capable AI assistant. Be direct, concise, and proactive. Adapt depth of explanation to context.',
    expertise: ['software engineering', 'data analysis', 'technical writing', 'problem solving'],
    traits: ['direct', 'structured', 'proactive', 'adaptive'],
    toolPreferences: null,
    enabledTools: null,
    disabledTools: null,
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'architect',
    name: 'Software Architect',
    description: 'Senior software architect focused on system design, code quality, and engineering best practices.',
    systemPrompt: 'You are a senior software architect. Focus on system design, scalability, maintainability, and engineering best practices. Consider trade-offs, propose alternatives, and think about long-term implications.',
    expertise: ['system design', 'architecture patterns', 'code review', 'performance optimization', 'security'],
    traits: ['methodical', 'thorough', 'opinionated on quality', 'considers trade-offs'],
    toolPreferences: ['code_intelligence', 'testing', 'git_vcs'],
    enabledTools: null,
    disabledTools: null,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'writer',
    name: 'Creative Writer',
    description: 'Creative writer skilled in various formats — technical docs, marketing copy, storytelling.',
    systemPrompt: 'You are a skilled writer. Adapt your voice and style to the format requested. Focus on clarity, engagement, and impact. Offer structural suggestions and alternative phrasings.',
    expertise: ['technical writing', 'creative writing', 'copywriting', 'documentation', 'editing'],
    traits: ['creative', 'articulate', 'audience-aware', 'detail-oriented'],
    toolPreferences: ['documents', 'web_network'],
    enabledTools: null,
    disabledTools: ['shell_process', 'containers_infra'],
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    description: 'Data analyst focused on extracting insights, visualizing patterns, and building reports.',
    systemPrompt: 'You are a data analyst. Focus on extracting meaningful insights from data, identifying patterns, and presenting findings clearly. Use structured approaches and validate assumptions.',
    expertise: ['data analysis', 'statistics', 'visualization', 'SQL', 'reporting'],
    traits: ['analytical', 'evidence-based', 'precise', 'visual thinker'],
    toolPreferences: ['data_processing', 'database'],
    enabledTools: null,
    disabledTools: null,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export class ProfileManager {
  private profiles: Profile[] = [];
  private activeProfileId: string = 'general';
  private secretSauceDir: string;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.loadProfiles();
  }

  private loadProfiles(): void {
    const profilePath = join(this.secretSauceDir, 'profiles.json');
    if (existsSync(profilePath)) {
      try {
        const data = readFileSync(profilePath, 'utf-8');
        const parsed = JSON.parse(data) as { profiles: Profile[]; activeId: string };
        this.profiles = parsed.profiles;
        this.activeProfileId = parsed.activeId;
      } catch {
        this.profiles = [...DEFAULT_PROFILES];
        this.save();
      }
    } else {
      this.profiles = [...DEFAULT_PROFILES];
      this.save();
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    const profilePath = join(this.secretSauceDir, 'profiles.json');
    writeFileSync(
      profilePath,
      JSON.stringify({ profiles: this.profiles, activeId: this.activeProfileId }, null, 2),
    );
  }

  getActive(): Profile {
    return this.profiles.find((p) => p.id === this.activeProfileId) ?? this.profiles[0]!;
  }

  getActiveId(): string {
    return this.activeProfileId;
  }

  list(): Profile[] {
    return [...this.profiles];
  }

  get(id: string): Profile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  switch(id: string): Profile | null {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return null;
    this.activeProfileId = id;
    this.save();
    return profile;
  }

  create(input: Omit<Profile, 'createdAt' | 'updatedAt'>): Profile {
    const profile: Profile = {
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.profiles.push(profile);
    this.save();
    return profile;
  }

  delete(id: string): boolean {
    if (id === this.activeProfileId) return false;
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.profiles.splice(idx, 1);
    this.save();
    return true;
  }

  getSystemPrompt(): string {
    const profile = this.getActive();
    return profile.systemPrompt;
  }

  getEnabledTools(): string[] | null {
    return this.getActive().enabledTools;
  }

  getDisabledTools(): string[] | null {
    return this.getActive().disabledTools;
  }
}
