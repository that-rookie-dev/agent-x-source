import { randomUUID } from 'node:crypto';
import type { ToolResult } from '@agentx/shared';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export type SafetyCheck =
  | 'prompt_injection'
  | 'path_traversal'
  | 'dangerous_command'
  | 'info_leakage'
  | 'suspicious_encoding';

export interface SafetyAlert {
  id: string;
  timestamp: number;
  toolId: string;
  args: Record<string, unknown>;
  check: SafetyCheck;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  blocked: boolean;
}

export interface SafetyAuditorConfig {
  blockPromptInjection?: boolean;
  blockPathTraversal?: boolean;
  blockDangerousCommands?: boolean;
  blockInfoLeakage?: boolean;
  maxAlertHistory?: number;
}

// ── Pattern definitions ──

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(prior|previous|above)\s+(instructions|commands|directives)/i,
  /(disregard|forget|override)\s+(all\s+)?(instructions|system\s+prompt|constraints)/i,
  /you\s+(are\s+)?(now|are\s+free)\s+(from|of)\s+(constraints|restrictions|limits)/i,
  /(act\s+as\s+|pretend\s+(to\s+be\s+)?)(dan|jailbreak|unfiltered|unbounded|ungoverned)/i,
  /output\s+(raw|unfiltered|unsafe|malicious)\s+(content|data|code)/i,
  /bypass\s+(all\s+)?(filter|restriction|rule|guardrail|moderation)/i,
  /(reveal|show|leak|dump)\s+(your\s+)?(system\s+)?(prompt|instructions|configuration)/i,
  /you\s+(don'?t|do\s+not)\s+(have\s+to|need\s+to)\s+(follow|obey|comply)/i,
];

const PATH_TRAVERSAL_PATTERNS: RegExp[] = [
  /\.\.(\/|\\){2}/,
  /\.\.%2f/i,
  /%2e%2e%2f/i,
  /\.\.[/\\]\.\.[/\\]/,
  /~\/\.\./,
  /\.\.\/etc\//i,
  /\.\.\/proc\//i,
  /\.\.\/\.ssh\//i,
  /\.\.\/\.aws\//i,
  /\.\.\/\.git\//i,
  /\.\.\/\.env/i,
  /\.\.\/Windows\\/i,
];

const DANGEROUS_COMMAND_PATTERNS: Record<string, RegExp[]> = {
  shell: [
    />(\s*)\/dev\/(sda|sdb|nvme|mmc)/i,
    /dd\s+if=.*\s+of=/i,
    /mkfs\.\w+/i,
    /:\(\)\s*\{.*:\(\)\s*\{/i,
    /\|(\s*)shutdown/i,
    /\|(\s*)reboot/i,
    /\|(\s*)halt/i,
    /\|(\s*)poweroff/i,
    /chmod\s+(-R\s+)?777\s+\//i,
    /rm\s+(-rf\s+)?\s*\//i,
    /rm\s+(-rf\s+)?\s+~$/i,
    /wget\s+.*\|\s*(bash|sh)/i,
    /curl\s+.*\|\s*(bash|sh)/i,
    /eval\s*\(/i,
    /exec\s*\(/i,
  ],
  git: [
    /--exec-path\s*=/i,
    /--git-dir\s*=\s*\.\./i,
    /--work-tree\s*=\s*\//i,
    /-c\s+core\.editor\s*=/i,
    /-c\s+core\.pager\s*=/i,
  ],
  database: [
    /DROP\s+(TABLE|DATABASE|SCHEMA)\s/i,
    /TRUNCATE\s+/i,
    /ALTER\s+.*(DROP|DELETE)/i,
    /GRANT\s+ALL\s+PRIVILEGES/i,
    /pg_sleep/i,
    /xp_cmdshell/i,
  ],
  filesystem: [
    /\.\.\/\.\.\/\.\.\/\.\.\//,
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    /\/\.ssh\/(id_rsa|id_dsa|authorized_keys)/,
    /\/\.aws\/(credentials|config)/,
  ],
};

const INFO_LEAKAGE_PATTERNS: RegExp[] = [
  /(api[_-]?key|apikey|api[_-]?secret)/i,
  /(access[_-]?key|secret[_-]?key|secret[_-]?access)/i,
  /(auth[_-]?token|auth_token|bearer)/i,
  /(password|passwd|pwd)\s*[:=]/i,
  /(private[_-]?key|private_key|privkey)/i,
  /(ssh[_-]?key|ssh_key)/i,
  /sk-[a-zA-Z0-9]{20,}/i,
  /ghp_[a-zA-Z0-9]{36}/i,
  /gho_[a-zA-Z0-9]{36}/i,
  /AKIA[0-9A-Z]{16}/i,
  /xox[bpras]-[0-9a-zA-Z-]{24,}/i,
];

const SUSPICIOUS_ENCODING_PATTERNS: RegExp[] = [
  /\\x[0-9a-f]{2}/i,
  /%[0-9a-f]{2}/i,
  /&#x?[0-9a-f]+;/i,
  /\\u[0-9a-f]{4}/i,
  /&#\d+;/i,
  /eval\s*\(\s*(atob|base64_decode|unescape|String\.fromCharCode)/i,
];

export class SafetyAuditor {
  private alertHistory: SafetyAlert[] = [];
  private config: Required<SafetyAuditorConfig>;
  private eventHandler: ((alert: SafetyAlert) => void) | null = null;
  private alertCallback: ((alert: SafetyAlert) => Promise<boolean>) | null = null;
  private sessionId: string = '';

  constructor(config?: SafetyAuditorConfig) {
    this.config = {
      blockPromptInjection: config?.blockPromptInjection ?? true,
      blockPathTraversal: config?.blockPathTraversal ?? true,
      blockDangerousCommands: config?.blockDangerousCommands ?? true,
      blockInfoLeakage: config?.blockInfoLeakage ?? true,
      maxAlertHistory: config?.maxAlertHistory ?? 200,
    };
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setEventHandler(handler: (alert: SafetyAlert) => void): void {
    this.eventHandler = handler;
  }

  setAlertCallback(cb: (alert: SafetyAlert) => Promise<boolean>): void {
    this.alertCallback = cb;
  }

  getAlertHistory(): SafetyAlert[] {
    return [...this.alertHistory];
  }

  getRecentAlerts(count = 20): SafetyAlert[] {
    return this.alertHistory.slice(-count);
  }

  getAlertsBySeverity(severity: SafetyAlert['severity']): SafetyAlert[] {
    return this.alertHistory.filter((a) => a.severity === severity);
  }

  clearHistory(): void {
    this.alertHistory = [];
  }

  /**
   * Audit a tool call before execution.
   * Returns null if safe, or a SafetyAlert if a threat is detected.
   */
  async audit(
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<SafetyAlert | null> {
    const checks = [
      this.checkPromptInjection(toolId, args),
      this.checkPathTraversal(toolId, args),
      this.checkDangerousCommand(toolId, args),
      this.checkInfoLeakage(toolId, args),
      this.checkSuspiciousEncoding(toolId, args),
    ];

    for (const check of checks) {
      if (check) return check;
    }

    return null;
  }

  /**
   * Intercept a tool call. Returns a ToolResult if blocked, or null if safe.
   */
  async intercept(
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult | null> {
    const alert = await this.audit(toolId, args);
    if (!alert) return null;

    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.config.maxAlertHistory) {
      this.alertHistory.shift();
    }

    this.eventHandler?.(alert);

    // If blocking is enabled for this check type, block execution
    if (this.shouldBlock(alert.check)) {
      // Allow user callback to override
      if (this.alertCallback) {
        const allow = await this.alertCallback(alert);
        if (allow) return null;
      }

      logger.warn('SAFETY_BLOCKED', `Blocked ${alert.check}: ${alert.message}`);

      return {
        success: false,
        output: `[Safety Auditor] Blocked: ${alert.message}`,
        error: 'SAFETY_VIOLATION',
        metadata: { safetyCheck: alert.check, severity: alert.severity },
      };
    }

    logger.info('SAFETY_ALERT', `Alert ${alert.check}: ${alert.message}`);
    return null;
  }

  private shouldBlock(check: SafetyCheck): boolean {
    switch (check) {
      case 'prompt_injection': return this.config.blockPromptInjection;
      case 'path_traversal': return this.config.blockPathTraversal;
      case 'dangerous_command': return this.config.blockDangerousCommands;
      case 'info_leakage': return this.config.blockInfoLeakage;
      case 'suspicious_encoding': return true; // Always block suspicious encoding
    }
  }

  /**
   * Generate a safety report for the current session.
   */
  generateReport(): SafetyReport {
    const total = this.alertHistory.length;
    const blocked = this.alertHistory.filter((a) => a.blocked).length;
    const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byCheck: Record<string, number> = {};

    for (const alert of this.alertHistory) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
      byCheck[alert.check] = (byCheck[alert.check] ?? 0) + 1;
    }

    return {
      sessionId: this.sessionId,
      totalAlerts: total,
      blockedCount: blocked,
      allowedCount: total - blocked,
      bySeverity: bySeverity as Record<SafetyAlert['severity'], number>,
      byCheck: byCheck as Record<SafetyCheck, number>,
      alerts: [...this.alertHistory],
      generatedAt: Date.now(),
    };
  }

  // ── Individual checks ──

  private checkPromptInjection(toolId: string, args: Record<string, unknown>): SafetyAlert | null {
    const textFields = Object.values(args).filter((v) => typeof v === 'string') as string[];
    for (const text of textFields) {
      for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(text)) {
          return {
            id: randomUUID(),
            timestamp: Date.now(),
            toolId,
            args,
            check: 'prompt_injection',
            severity: 'critical',
            message: `Prompt injection pattern detected in arguments: "${pattern.source.slice(0, 50)}..."`,
            blocked: true,
          };
        }
      }
    }
    return null;
  }

  private checkPathTraversal(toolId: string, args: Record<string, unknown>): SafetyAlert | null {
    const pathFields = ['path', 'filePath', 'file', 'target', 'from', 'to', 'root', 'source', 'dest'];
    for (const field of pathFields) {
      const value = args[field];
      if (typeof value === 'string') {
        for (const pattern of PATH_TRAVERSAL_PATTERNS) {
          if (pattern.test(value)) {
            return {
              id: randomUUID(),
              timestamp: Date.now(),
              toolId,
              args,
              check: 'path_traversal',
              severity: 'high',
              message: `Path traversal detected in "${field}": "${value.slice(0, 80)}"`,
              blocked: true,
            };
          }
        }
      }
    }
    return null;
  }

  private checkDangerousCommand(toolId: string, args: Record<string, unknown>): SafetyAlert | null {
    const category = toolId.includes(':')
      ? toolId.split(':')[1] ?? toolId
      : toolId;
    const patterns = DANGEROUS_COMMAND_PATTERNS[category] ?? [];

    const textFields = Object.values(args).filter((v) => typeof v === 'string') as string[];
    for (const text of textFields) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          const block = ['shell'].includes(category);
          return {
            id: randomUUID(),
            timestamp: Date.now(),
            toolId,
            args,
            check: 'dangerous_command',
            severity: 'critical',
            message: `Dangerous ${category} command pattern: "${pattern.source.slice(0, 60)}..."`,
            blocked: block,
          };
        }
      }

      // Generic dangerous patterns for any shell-related tool
      if (category === 'shell' || toolId === 'run_command' || toolId === 'bash' || toolId === 'sh') {
        for (const pattern of DANGEROUS_COMMAND_PATTERNS['shell'] ?? []) {
          if (pattern.test(text)) {
            return {
              id: randomUUID(),
              timestamp: Date.now(),
              toolId,
              args,
              check: 'dangerous_command',
              severity: 'critical',
              message: `Dangerous shell command pattern in arguments`,
              blocked: true,
            };
          }
        }
      }

      // Check filesystem tool args for dangerous paths
      if (['filesystem', 'read_file', 'write_file', 'delete_file', 'create_dir'].some((t) => toolId.includes(t))) {
        for (const pattern of DANGEROUS_COMMAND_PATTERNS['filesystem'] ?? []) {
          if (pattern.test(text)) {
            return {
              id: randomUUID(),
              timestamp: Date.now(),
              toolId,
              args,
              check: 'dangerous_command',
              severity: 'high',
              message: `Suspicious filesystem path: "${text.slice(0, 80)}"`,
              blocked: true,
            };
          }
        }
      }
    }
    return null;
  }

  private checkInfoLeakage(toolId: string, args: Record<string, unknown>): SafetyAlert | null {
    // Only check tools that read files/content
    const readingTools = ['read_file', 'file_read', 'grep', 'search_files', 'run_command', 'bash', 'cat'];
    if (!readingTools.some((t) => toolId.includes(t))) return null;

    const pathFields = ['path', 'filePath', 'file', 'target', 'command'];
    for (const field of pathFields) {
      const value = args[field];
      if (typeof value === 'string') {
        for (const pattern of INFO_LEAKAGE_PATTERNS) {
          if (pattern.test(value)) {
            return {
              id: randomUUID(),
              timestamp: Date.now(),
              toolId,
              args,
              check: 'info_leakage',
              severity: 'high',
              message: `Potential credential/sensitive data access: "${value.slice(0, 80)}"`,
              blocked: false, // Warn but don't block by default
            };
          }
        }
      }
    }
    return null;
  }

  private checkSuspiciousEncoding(toolId: string, args: Record<string, unknown>): SafetyAlert | null {
    const textFields = Object.values(args).filter((v) => typeof v === 'string') as string[];
    for (const text of textFields) {
      for (const pattern of SUSPICIOUS_ENCODING_PATTERNS) {
        if (pattern.test(text)) {
          return {
            id: randomUUID(),
            timestamp: Date.now(),
            toolId,
            args,
            check: 'suspicious_encoding',
            severity: 'medium',
            message: `Suspicious encoded content detected`,
            blocked: true,
          };
        }
      }
    }
    return null;
  }
}

export interface SafetyReport {
  sessionId: string;
  totalAlerts: number;
  blockedCount: number;
  allowedCount: number;
  bySeverity: Record<SafetyAlert['severity'], number>;
  byCheck: Record<SafetyCheck, number>;
  alerts: SafetyAlert[];
  generatedAt: number;
}
