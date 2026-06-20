import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getLogger } from '@agentx/shared';
import { getConfigDir } from '../config/paths.js';

const logger = getLogger();

// ── Policy Rule Types ──

export type PolicyEffect = 'allow' | 'deny';

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  description: string;
  /** Tool ID glob pattern (e.g., "shell:*", "mcp:*", "file_write") */
  toolPattern: string;
  /** Optional path glob pattern (e.g., "/etc/**", "~/.ssh/*") */
  pathPattern?: string;
  /** Optional model name pattern */
  modelPattern?: string;
  /** Priority — higher wins on conflict (default: 0) */
  priority?: number;
  /** Optional expiry timestamp */
  expiresAt?: number;
}

export interface PolicyDocument {
  version: '1.0';
  rules: PolicyRule[];
  metadata?: {
    name?: string;
    description?: string;
    organization?: string;
    updatedAt?: string;
  };
}

// ── Audit Log ──

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  toolId: string;
  args: Record<string, unknown>;
  result: { success: boolean; error?: string };
  sessionId: string;
  userId?: string;
  duration: number;
}

// ── Managed Settings ──

export interface ManagedSettings {
  allowedModels: string[];
  blockedModels: string[];
  allowedProviders: string[];
  defaultProvider?: string;
  defaultModel?: string;
  maxBudgetPerSession?: number;
  maxToolsPerSession?: number;
  maxConcurrentAgents?: number;
  allowedTools: string[];
  blockedTools: string[];
  scopePaths: string[];
  telemetryEndpoint?: string;
  telemetryEnabled: boolean;
  safetyLevel: 'low' | 'medium' | 'high' | 'critical';
  customConfig?: Record<string, unknown>;
}

// ── SSO Provider ──

export interface SSOConfig {
  provider: 'google' | 'github' | 'microsoft' | 'custom';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[];
}

export interface SSOUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: string;
}

export interface SSOProvider {
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string, state: string): Promise<SSOUser>;
  refreshToken?(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
}

// ── Policy Engine ──

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private settings: ManagedSettings | null = null;
  private auditLog: AuditEntry[] = [];
  private ssoConfigs: Map<string, SSOConfig> = new Map();
  private ssoProviders: Map<string, SSOProvider> = new Map();
  private policyPath: string;
  private auditLogPath: string;
  private settingsPath: string;
  private maxAuditEntries: number;

  constructor(options?: {
    policyPath?: string;
    auditLogPath?: string;
    settingsPath?: string;
    maxAuditEntries?: number;
  }) {
    const configDir = getConfigDir();
    this.policyPath = options?.policyPath ?? join(configDir, 'policy.json');
    this.auditLogPath = options?.auditLogPath ?? join(configDir, 'audit.jsonl');
    this.settingsPath = options?.settingsPath ?? join(configDir, 'settings.json');
    this.maxAuditEntries = options?.maxAuditEntries ?? 10000;
    this.loadPolicy();
    this.loadSettings();
    this.loadAuditLog();
  }

  // ── Policy Management ──

  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.savePolicy();
  }

  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    this.savePolicy();
    return true;
  }

  clearRules(): void {
    this.rules = [];
    this.savePolicy();
  }

  /**
   * Evaluate a tool call against all policies.
   * Returns 'allow', 'deny', or 'default' (no matching rule).
   */
  evaluate(toolId: string, path?: string, model?: string): PolicyEffect | 'default' {
    for (const rule of this.rules) {
      if (rule.expiresAt && Date.now() > rule.expiresAt) continue;
      if (!this.matchPattern(toolId, rule.toolPattern)) continue;
      if (rule.pathPattern && !this.matchPattern(path ?? '', rule.pathPattern)) continue;
      if (rule.modelPattern && !this.matchPattern(model ?? '', rule.modelPattern)) continue;
      return rule.effect;
    }
    return 'default';
  }

  // ── Managed Settings ──

  getSettings(): ManagedSettings | null {
    return this.settings;
  }

  updateSettings(settings: Partial<ManagedSettings>): void {
    if (!this.settings) {
      this.settings = this.getDefaultSettings();
    }
    this.settings = { ...this.settings, ...settings };
    this.saveSettings();
  }

  resetSettings(): void {
    this.settings = this.getDefaultSettings();
    this.saveSettings();
  }

  // ── Audit Logging ──

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  getAuditLogBySession(sessionId: string): AuditEntry[] {
    return this.auditLog.filter((e) => e.sessionId === sessionId);
  }

  getAuditLogByTool(toolId: string): AuditEntry[] {
    return this.auditLog.filter((e) => e.toolId === toolId);
  }

  logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    const audit: AuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.auditLog.push(audit);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditEntries);
    }
    this.appendAuditEntry(audit);
  }

  generateAuditReport(sessionId?: string): {
    totalActions: number;
    successRate: number;
    topTools: Array<{ toolId: string; count: number }>;
    errorRate: number;
  } {
    const entries = sessionId ? this.getAuditLogBySession(sessionId) : this.auditLog;
    const total = entries.length;
    const successful = entries.filter((e) => e.result.success).length;
    const toolCounts: Record<string, number> = {};

    for (const e of entries) {
      toolCounts[e.toolId] = (toolCounts[e.toolId] ?? 0) + 1;
    }

    const topTools = Object.entries(toolCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([toolId, count]) => ({ toolId, count }));

    return {
      totalActions: total,
      successRate: total > 0 ? successful / total : 1,
      topTools,
      errorRate: total > 0 ? (total - successful) / total : 0,
    };
  }

  // ── SSO / OAuth ──

  registerSSOProvider(config: SSOConfig, provider: SSOProvider): void {
    this.ssoConfigs.set(config.provider, config);
    this.ssoProviders.set(config.provider, provider);
  }

  getSSOConfig(provider: string): SSOConfig | undefined {
    return this.ssoConfigs.get(provider);
  }

  getSSOProvider(provider: string): SSOProvider | undefined {
    return this.ssoProviders.get(provider);
  }

  getConfiguredProviders(): string[] {
    return [...this.ssoConfigs.keys()];
  }

  // ── Private helpers ──

  private matchPattern(value: string, pattern: string): boolean {
    // Simple glob matching: * matches anything, ** matches across path segments
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*');
    try {
      return new RegExp(`^${regexStr}$`).test(value);
    } catch {
      return value === pattern;
    }
  }

  private getDefaultSettings(): ManagedSettings {
    return {
      allowedModels: [],
      blockedModels: [],
      allowedProviders: [],
      allowedTools: [],
      blockedTools: [],
      scopePaths: [],
      telemetryEnabled: false,
      safetyLevel: 'medium',
    };
  }

  private loadPolicy(): void {
    try {
      if (!existsSync(this.policyPath)) return;
      const raw = readFileSync(this.policyPath, 'utf-8');
      const doc: PolicyDocument = JSON.parse(raw);
      this.rules = doc.rules ?? [];
    } catch (e) {
      logger.error('POLICY_LOAD_FAILED', e);
    }
  }

  private savePolicy(): void {
    try {
      const doc: PolicyDocument = {
        version: '1.0',
        rules: this.rules,
      };
      const dir = dirname(this.policyPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.policyPath, JSON.stringify(doc, null, 2), 'utf-8');
    } catch (e) {
      logger.error('POLICY_SAVE_FAILED', e);
    }
  }

  private loadSettings(): void {
    try {
      if (!existsSync(this.settingsPath)) return;
      const raw = readFileSync(this.settingsPath, 'utf-8');
      this.settings = JSON.parse(raw);
      const s = this.settings;
      if (!s) return;

      // Apply environment variable overrides
      if (process.env['AGENTX_DEFAULT_MODEL']) {
        s.defaultModel = process.env['AGENTX_DEFAULT_MODEL'];
      }
      if (process.env['AGENTX_MAX_BUDGET']) {
        s.maxBudgetPerSession = parseFloat(process.env['AGENTX_MAX_BUDGET']);
      }
      if (process.env['AGENTX_TELEMETRY_ENDPOINT']) {
        s.telemetryEndpoint = process.env['AGENTX_TELEMETRY_ENDPOINT'];
      }
      if (process.env['AGENTX_SAFETY_LEVEL']) {
        s.safetyLevel = process.env['AGENTX_SAFETY_LEVEL'] as ManagedSettings['safetyLevel'];
      }
    } catch (e) {
      logger.error('SETTINGS_LOAD_FAILED', e);
    }
  }

  private saveSettings(): void {
    try {
      const dir = dirname(this.settingsPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (e) {
      logger.error('SETTINGS_SAVE_FAILED', e);
    }
  }

  private loadAuditLog(): void {
    try {
      if (!existsSync(this.auditLogPath)) return;
      const raw = readFileSync(this.auditLogPath, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      // Only load last N entries for memory
      const start = Math.max(0, lines.length - this.maxAuditEntries);
      this.auditLog = lines.slice(start).map((line) => JSON.parse(line));
    } catch (e) {
      logger.error('AUDIT_LOG_LOAD_FAILED', e);
    }
  }

  private appendAuditEntry(entry: AuditEntry): void {
    try {
      const dir = dirname(this.auditLogPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.auditLogPath, JSON.stringify(entry) + '\n', { flag: 'a' });
    } catch (e) {
      logger.error('AUDIT_LOG_APPEND_FAILED', e);
    }
  }
}

// ── Built-in SSO Providers ──

export class GoogleSSOProvider implements SSOProvider {
  private config: SSOConfig;

  constructor(config: SSOConfig) {
    this.config = config;
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: (this.config.scopes ?? ['openid', 'email', 'profile']).join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string, _state: string): Promise<SSOUser> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const user = (await userRes.json()) as { id: string; email: string; name: string; picture?: string };
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.picture,
      provider: 'google',
    };
  }
}

export class GitHubSSOProvider implements SSOProvider {
  private config: SSOConfig;

  constructor(config: SSOConfig) {
    this.config = config;
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: (this.config.scopes ?? ['read:user', 'user:email']).join(' '),
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, _state: string): Promise<SSOUser> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const user = (await userRes.json()) as { id: number; email: string; name: string; avatar_url?: string };
    return {
      id: String(user.id),
      email: user.email,
      name: user.name ?? user.email,
      avatar: user.avatar_url,
      provider: 'github',
    };
  }
}
