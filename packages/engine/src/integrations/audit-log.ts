import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IntegrationAuditEntry } from '@agentx/shared';
import { getDataDir } from '@agentx/shared';

export class IntegrationAuditLog {
  private readonly logPath: string;

  constructor(baseDir?: string) {
    const dir = join(baseDir ?? getDataDir(), 'integrations');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, 'audit.log');
  }

  append(entry: Omit<IntegrationAuditEntry, 'id' | 'timestamp'>): IntegrationAuditEntry {
    const full: IntegrationAuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const line = [
      full.timestamp,
      full.providerId,
      full.toolName,
      full.readonly ? 'READ' : 'WRITE',
      full.success ? 'OK' : 'FAIL',
      full.argsSummary ?? '',
      full.error ?? '',
    ].join('\t');
    appendFileSync(this.logPath, `${line}\n`, 'utf-8');
    return full;
  }

  tail(limit = 100): IntegrationAuditEntry[] {
    if (!existsSync(this.logPath)) return [];
    const lines = readFileSync(this.logPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      const [timestamp, providerId, toolName, mode, status, argsSummary, error] = line.split('\t');
      return {
        id: `${timestamp}:${toolName}`,
        timestamp: timestamp ?? '',
        connectionId: '',
        providerId: providerId ?? '',
        toolName: toolName ?? '',
        toolId: '',
        readonly: mode === 'READ',
        success: status === 'OK',
        argsSummary: argsSummary || undefined,
        error: error || undefined,
      };
    });
  }
}
