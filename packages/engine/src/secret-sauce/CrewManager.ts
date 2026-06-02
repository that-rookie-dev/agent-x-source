import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Crew, CrewEmotion } from '@agentx/shared';
import { encrypt, decrypt, getLogger } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';
import { getSecretSauceDir } from '../config/paths.js';

/**
 * No default crews — user creates their own.
 * A minimal "Default" crew is auto-created only if none exist,
 * with a generic prompt so the app can function.
 */
const BOOTSTRAP_CREW: Crew = {
  id: 'default',
  name: 'Default',
  systemPrompt: 'You are a highly capable AI assistant. Be direct, concise, and helpful.',
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export class CrewManager {
  private crews: Crew[] = [];
  private activeCrewId: string = 'default';
  private secretSauceDir: string;
  private dek: Buffer | null = null;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.loadCrews();
  }

  /**
   * Set DEK for encrypting crew data at rest.
   * Re-loads crews (decrypted) and re-saves encrypted when DEK is first set.
   */
  setDEK(dek: Buffer | null): void {
    const hadDEK = this.dek !== null;
    this.dek = dek;
    if (dek && !hadDEK) {
      // Reload crews now that we can decrypt
      this.loadCrews();
      // Re-save encrypted (migrates plaintext → encrypted)
      this.save();
    }
  }

  private loadCrews(): void {
    const crewPath = join(this.secretSauceDir, 'crews.json');
    if (existsSync(crewPath)) {
      try {
        const raw = readFileSync(crewPath, 'utf-8');
        let data: string;

        // Detect encrypted format
        const rawParsed = JSON.parse(raw);
        if (rawParsed.__enc === true) {
          if (!this.dek) {
            // Cannot decrypt without DEK — will reload after login injects DEK
            getLogger().warn('CREW_MGR', 'Encrypted crews.json found but no DEK set. Showing bootstrap crew only. Call setDEK() to unlock.');
            this.crews = [BOOTSTRAP_CREW];
            this.activeCrewId = 'default';
            return;
          }
          data = decrypt(rawParsed as EncryptedData, this.dek);
        } else {
          data = raw;
        }

        const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as { crews: Array<Record<string, unknown>>; activeId: string };
        // Migrate old crews: strip removed fields, keep name + systemPrompt + emotion
        this.crews = parsed.crews.map((p) => ({
          id: p['id'] as string,
          name: p['name'] as string,
          systemPrompt: (p['systemPrompt'] as string) ?? '',
          emotion: (p['emotion'] as CrewEmotion | undefined),
          isDefault: (p['isDefault'] as boolean) ?? false,
          createdAt: (p['createdAt'] as string) ?? new Date().toISOString(),
          updatedAt: (p['updatedAt'] as string) ?? new Date().toISOString(),
        }));
        this.activeCrewId = parsed.activeId;
        // Ensure at least one crew exists
        if (this.crews.length === 0) {
          this.crews = [BOOTSTRAP_CREW];
          this.activeCrewId = 'default';
        }
      } catch {
        this.crews = [BOOTSTRAP_CREW];
        this.save();
      }
    } else {
      this.crews = [BOOTSTRAP_CREW];
      this.save();
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    const crewPath = join(this.secretSauceDir, 'crews.json');
    const payload = JSON.stringify({ crews: this.crews, activeId: this.activeCrewId }, null, 2);

    if (this.dek) {
      // Encrypt the entire crews file
      const encrypted = encrypt(payload, this.dek);
      writeFileSync(crewPath, JSON.stringify({ __enc: true, ...encrypted }));
    } else {
      writeFileSync(crewPath, payload);
    }
  }

  getActive(): Crew {
    return this.crews.find((p) => p.id === this.activeCrewId) ?? this.crews[0]!;
  }

  getActiveId(): string {
    return this.activeCrewId;
  }

  list(): Crew[] {
    return [...this.crews];
  }

  get(id: string): Crew | undefined {
    return this.crews.find((p) => p.id === id);
  }

  switch(id: string): Crew | null {
    const crew = this.crews.find((p) => p.id === id);
    if (!crew) return null;
    this.activeCrewId = id;
    this.save();
    return crew;
  }

  create(input: { id: string; name: string; systemPrompt: string; emotion?: CrewEmotion; isDefault?: boolean }): Crew {
    const crew: Crew = {
      id: input.id,
      name: input.name,
      systemPrompt: input.systemPrompt,
      emotion: input.emotion,
      isDefault: input.isDefault ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.crews.push(crew);
    this.save();
    return crew;
  }

  delete(id: string): boolean {
    if (id === this.activeCrewId) return false;
    if (this.crews.length <= 1) return false;
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.crews.splice(idx, 1);
    this.save();
    return true;
  }

  update(id: string, updates: { name?: string; systemPrompt?: string; emotion?: CrewEmotion }): Crew | null {
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const crew = this.crews[idx]!;
    if (updates.name !== undefined) crew.name = updates.name;
    if (updates.systemPrompt !== undefined) crew.systemPrompt = updates.systemPrompt;
    if (updates.emotion !== undefined) crew.emotion = updates.emotion;
    crew.updatedAt = new Date().toISOString();
    this.crews[idx] = crew;
    this.save();
    return crew;
  }

  getSystemPrompt(): string {
    const crew = this.getActive();
    return crew.systemPrompt;
  }
}
