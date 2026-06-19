import type { PromptBundle, NormalizedTurn } from '@agentx/shared';
import type { Session } from '@agentx/shared';
import { PromptCache } from './PromptCache.js';
import { PROVIDER_OVERLAYS } from './ProviderOverlays.js';
import { createHash } from 'node:crypto';

export const CACHE_BOUNDARY_MARKER = '\n<!-- AGENTX_CACHE_BOUNDARY -->\n';

export class PromptComposer {
  private promptCache: PromptCache | null = null;

  setCache(cache: PromptCache): void {
    this.promptCache = cache;
  }

  async compose(
    session: Session,
    turn: NormalizedTurn,
    contextFiles?: string[],
    memorySnapshot?: string,
  ): Promise<PromptBundle> {
    const providerOverlay = PROVIDER_OVERLAYS[session.providerId] ?? '';

    const stablePrefix = this.buildStablePrefix(providerOverlay);
    const stableHash = this.hashStable(stablePrefix);

    const dynamicSuffix = this.buildDynamicSuffix(session, contextFiles);
    const volatileSuffix = this.buildVolatileSuffix(turn, memorySnapshot);

    const cacheEntry = this.promptCache?.lookup(session.id, stableHash);

    const cachedPrefix = cacheEntry?.stablePrefix ?? stablePrefix;

    const fullSystemPrompt = [
      cachedPrefix,
      CACHE_BOUNDARY_MARKER,
      dynamicSuffix,
      volatileSuffix,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      stablePrefix: cachedPrefix,
      cacheBoundary: CACHE_BOUNDARY_MARKER,
      dynamicSuffix,
      volatileSuffix,
      fullSystemPrompt,
      stableHash,
      providerOverlay: providerOverlay || undefined,
    };
  }

  private buildStablePrefix(providerOverlay: string): string {
    const sections: string[] = [
      '## Behavioral Guidelines',
      '- You are a helpful, accurate, and safe AI agent.',
      '- You operate in a terminal environment with full tool access.',
      '',
      '## Tool Discipline',
      '- Always use tools to perform file operations, execution, and searches.',
      '- Read files before editing them.',
      '- Verify changes with git diff before committing.',
      '- Never assume file contents without first reading.',
      '',
      '## Safety Constraints',
      '- Never execute malicious code or unsafe shell commands.',
      '- Respect scope boundaries — do not access files outside the workspace.',
      '- Ask for confirmation before destructive operations (git reset, rm -rf, etc.).',
      '- Do not expose secrets, keys, or credentials in output.',
      '',
      '## Environment',
      '- Working directory: available via tool calls.',
      '- Git-aware: use git commands for version control.',
      '- Cross-platform: commands should work on macOS, Linux, and Windows.',
    ];

    if (providerOverlay) {
      sections.push('', providerOverlay);
    }

    const text = sections.join('\n');
    return this.normalizeWhitespace(text);
  }

  private buildDynamicSuffix(
    session: Session,
    contextFiles?: string[],
  ): string {
    const parts: string[] = [];

    if (contextFiles && contextFiles.length > 0) {
      parts.push('## Project Context Files');
      for (const file of contextFiles.slice(0, 10)) {
        parts.push(`- ${file}`);
      }
    }

    parts.push(
      '',
      `## Session Info`,
      `- Session ID: ${session.id}`,
      `- Scope: ${session.scopePath}`,
      `- Model: ${session.modelId}`,
    );

    return parts.join('\n');
  }

  private buildVolatileSuffix(
    turn: NormalizedTurn,
    memorySnapshot?: string,
  ): string {
    const parts: string[] = [];

    if (memorySnapshot) {
      parts.push('## Memory Snapshot', memorySnapshot, '');
    }

    parts.push(
      `## Turn Info`,
      `- Turn ID: ${turn.turnId}`,
      `- Timestamp: ${new Date().toISOString()}`,
      `- Input length: ${turn.cleanText.length} chars`,
    );

    return parts.join('\n');
  }

  private hashStable(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  }

  private normalizeWhitespace(text: string): string {
    return text
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
