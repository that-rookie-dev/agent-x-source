import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Crew, CrewEmotion, CrewCreateInput, CollaborationProtocol, CrewResourceQuota } from '@agentx/shared';
import { encrypt, decrypt, getLogger } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';
import { getSecretSauceDir } from '../config/paths.js';

export class CrewManager {
  private crews: Crew[] = [];
  private secretSauceDir: string;
  private dek: Buffer | null = null;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.loadCrews();
  }

  setDEK(dek: Buffer | null): void {
    const hadDEK = this.dek !== null;
    this.dek = dek;
    if (dek && !hadDEK) {
      this.loadCrews();
      this.save();
    }
  }

  refresh(): void {
    this.loadCrews();
  }

  private loadCrews(): void {
    const crewPath = join(this.secretSauceDir, 'crews.json');
    if (existsSync(crewPath)) {
      try {
        const raw = readFileSync(crewPath, 'utf-8');
        let data: string;

        const rawParsed = JSON.parse(raw);
        if (rawParsed.__enc === true) {
          if (!this.dek) {
            getLogger().warn('CREW_MGR', 'Encrypted crews.json found but no DEK set. Call setDEK() to unlock.');
            this.crews = [];
            return;
          }
          data = decrypt(rawParsed as EncryptedData, this.dek);
        } else {
          data = raw;
        }

        const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as { crews: Array<Record<string, unknown>>; activeId?: string | null };
        this.crews = parsed.crews.map((p) => ({
          id: p['id'] as string,
          name: p['name'] as string,
          title: (p['title'] as string | undefined),
          callsign: (p['callsign'] as string) ?? (p['id'] as string),
          systemPrompt: (p['systemPrompt'] as string) ?? '',
          emotion: (p['emotion'] as CrewEmotion | undefined),
          isDefault: (p['isDefault'] as boolean) ?? false,
          enabled: (p['enabled'] as boolean) ?? true,
          expertise: (p['expertise'] as string[] | undefined),
          traits: (p['traits'] as string[] | undefined),
          toolPreferences: (p['toolPreferences'] as { enabled?: string[]; disabled?: string[] } | undefined),
          createdAt: (p['createdAt'] as string) ?? new Date().toISOString(),
          updatedAt: (p['updatedAt'] as string) ?? new Date().toISOString(),
        }));
      } catch {
        this.crews = [];
        this.save();
      }
    } else {
      this.crews = [];
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    const crewPath = join(this.secretSauceDir, 'crews.json');
    const payload = JSON.stringify({ crews: this.crews }, null, 2);

    if (this.dek) {
      const encrypted = encrypt(payload, this.dek);
      writeFileSync(crewPath, JSON.stringify({ __enc: true, ...encrypted }));
    } else {
      writeFileSync(crewPath, payload);
    }
  }

  list(): Crew[] {
    return [...this.crews];
  }

  listEnabled(): Crew[] {
    return this.crews.filter((c) => c.enabled);
  }

  get(id: string): Crew | undefined {
    return this.crews.find((p) => p.id === id);
  }

  enable(id: string): boolean {
    const crew = this.crews.find((p) => p.id === id);
    if (!crew) return false;
    crew.enabled = true;
    crew.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  disable(id: string): boolean {
    const crew = this.crews.find((p) => p.id === id);
    if (!crew) return false;
    crew.enabled = false;
    crew.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  create(input: CrewCreateInput): Crew {
    const callsign = (input.callsign || input.name).replace(/\s+/g, '').toLowerCase();
    if (!/^\S+$/.test(callsign)) {
      throw new Error('Callsign must not contain spaces');
    }
    if (this.crews.some((c) => c.callsign === callsign)) {
      throw new Error(`Callsign "${callsign}" is already taken`);
    }
    const crew: Crew = {
      id: input.id,
      name: input.name,
      title: input.title,
      callsign,
      systemPrompt: input.systemPrompt,
      emotion: input.emotion,
      isDefault: input.isDefault ?? false,
      enabled: input.enabled ?? true,
      expertise: input.expertise,
      traits: input.traits,
      toolPreferences: input.toolPreferences,
      protocol: input.protocol,
      quotas: input.quotas,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.crews.push(crew);
    this.save();
    return crew;
  }

  delete(id: string): boolean {
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.crews.splice(idx, 1);
    this.save();
    return true;
  }

  update(id: string, updates: { name?: string; title?: string; callsign?: string; systemPrompt?: string; emotion?: CrewEmotion; expertise?: string[]; traits?: string[]; toolPreferences?: { enabled?: string[]; disabled?: string[] }; protocol?: CollaborationProtocol; quotas?: CrewResourceQuota }): Crew | null {
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const crew = this.crews[idx]!;
    if (updates.name !== undefined) crew.name = updates.name;
    if (updates.title !== undefined) crew.title = updates.title;
    if (updates.callsign !== undefined) {
      const cs = updates.callsign.replace(/\s+/g, '').toLowerCase();
      if (!/^\S+$/.test(cs)) throw new Error('Callsign must not contain spaces');
      if (this.crews.some((c) => c.callsign === cs && c.id !== id)) throw new Error(`Callsign "${cs}" is already taken`);
      crew.callsign = cs;
    }
    if (updates.systemPrompt !== undefined) crew.systemPrompt = updates.systemPrompt;
    if (updates.emotion !== undefined) crew.emotion = updates.emotion;
    if (updates.expertise !== undefined) crew.expertise = updates.expertise;
    if (updates.traits !== undefined) crew.traits = updates.traits;
    if (updates.toolPreferences !== undefined) crew.toolPreferences = updates.toolPreferences;
    if (updates.protocol !== undefined) crew.protocol = updates.protocol;
    if (updates.quotas !== undefined) crew.quotas = updates.quotas;
    crew.updatedAt = new Date().toISOString();
    this.crews[idx] = crew;
    this.save();
    return crew;
  }

  getMultiCrewSystemPrompt(): string {
    const enabledCrews = this.listEnabled();
    if (enabledCrews.length === 0) return '';

    const crewDescriptions = enabledCrews.map((c) => {
      const expertise = c.expertise?.join(', ') || 'general';
      const description = c.title ? `${c.name} — ${c.title}` : c.name;
      return `- **${description}** (@${c.callsign}): ${expertise}`;
    }).join('\n');

    return `You are Agent-X, the master orchestrator. The following crew members are available in this session:\n\n${crewDescriptions}\n\n**Group Chat Rules:**\n- Users can @mention a specific crew member to get their expertise\n- If no crew is mentioned, you (Agent-X) respond as the primary assistant\n- You can delegate to crew members when their expertise is relevant\n- Crew members respond with their unique personalities and knowledge\n- Maintain context across the conversation - all participants see the full history`;
  }
}
