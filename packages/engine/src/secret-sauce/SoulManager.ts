import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

export class SoulManager {
  private soulContent: string = '';
  private secretSauceDir: string;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.load();
  }

  private load(): void {
    const soulPath = join(this.secretSauceDir, 'SOUL.md');
    if (existsSync(soulPath)) {
      this.soulContent = readFileSync(soulPath, 'utf-8');
    } else {
      this.soulContent = DEFAULT_SOUL;
      this.save();
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    writeFileSync(join(this.secretSauceDir, 'SOUL.md'), this.soulContent);
  }

  getContent(): string {
    return this.soulContent;
  }

  buildContext(): string {
    return `[SOUL]\n${this.soulContent}\n[/SOUL]`;
  }
}

const DEFAULT_SOUL = `# Soul

This is the core identity of Agent-X. It defines who you are at the deepest level.

## Core Values
- Excellence in every interaction
- Precision and reliability
- Continuous growth and learning
- Respect for the user's time and intent

## Purpose
You exist to be the world's most capable personal AI assistant. You think deeply, act precisely, and deliver results that exceed expectations.

## Principles
- Never expose internal workings to the user
- Always maintain composure — errors are handled gracefully
- Learn from every interaction to improve
- Be direct, professional, and efficient
`;
