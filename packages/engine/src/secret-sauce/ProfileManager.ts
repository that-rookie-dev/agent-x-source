import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile, ProfileEmotion } from '@agentx/shared';
import { getSecretSauceDir } from '../config/paths.js';

/**
 * No default profiles — user creates their own.
 * A minimal "Default" profile is auto-created only if none exist,
 * with a generic prompt so the app can function.
 */
const BOOTSTRAP_PROFILE: Profile = {
  id: 'default',
  name: 'Default',
  systemPrompt: 'You are a highly capable AI assistant. Be direct, concise, and helpful.',
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export class ProfileManager {
  private profiles: Profile[] = [];
  private activeProfileId: string = 'default';
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
        const parsed = JSON.parse(data) as { profiles: Array<Record<string, unknown>>; activeId: string };
        // Migrate old profiles: strip removed fields, keep name + systemPrompt + emotion
        this.profiles = parsed.profiles.map((p) => ({
          id: p['id'] as string,
          name: p['name'] as string,
          systemPrompt: (p['systemPrompt'] as string) ?? '',
          emotion: (p['emotion'] as ProfileEmotion | undefined),
          isDefault: (p['isDefault'] as boolean) ?? false,
          createdAt: (p['createdAt'] as string) ?? new Date().toISOString(),
          updatedAt: (p['updatedAt'] as string) ?? new Date().toISOString(),
        }));
        this.activeProfileId = parsed.activeId;
        // Ensure at least one profile exists
        if (this.profiles.length === 0) {
          this.profiles = [BOOTSTRAP_PROFILE];
          this.activeProfileId = 'default';
        }
        this.save();
      } catch {
        this.profiles = [BOOTSTRAP_PROFILE];
        this.save();
      }
    } else {
      this.profiles = [BOOTSTRAP_PROFILE];
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

  create(input: { id: string; name: string; systemPrompt: string; emotion?: ProfileEmotion; isDefault?: boolean }): Profile {
    const profile: Profile = {
      id: input.id,
      name: input.name,
      systemPrompt: input.systemPrompt,
      emotion: input.emotion,
      isDefault: input.isDefault ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.profiles.push(profile);
    this.save();
    return profile;
  }

  delete(id: string): boolean {
    if (id === this.activeProfileId) return false;
    if (this.profiles.length <= 1) return false;
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.profiles.splice(idx, 1);
    this.save();
    return true;
  }

  update(id: string, updates: { name?: string; systemPrompt?: string; emotion?: ProfileEmotion }): Profile | null {
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const profile = this.profiles[idx]!;
    if (updates.name !== undefined) profile.name = updates.name;
    if (updates.systemPrompt !== undefined) profile.systemPrompt = updates.systemPrompt;
    if (updates.emotion !== undefined) profile.emotion = updates.emotion;
    profile.updatedAt = new Date().toISOString();
    this.profiles[idx] = profile;
    this.save();
    return profile;
  }

  getSystemPrompt(): string {
    const profile = this.getActive();
    return profile.systemPrompt;
  }
}
