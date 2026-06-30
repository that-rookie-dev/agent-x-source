/**
 * PII redaction and secure vault tokens for memory content.
 *
 * Replaces sensitive patterns (email, phone, SSN, credit card, API keys,
 * passwords) with stable vault tokens before storing in the neural fabric.
 * Original values are encrypted in the `secure_vault` table.
 */
import { SecureVault } from './SecureVault.js';

export interface PiiRedactionResult {
  redacted: string;
  tokens: Record<string, string>;
  touched: boolean;
}

export interface PiiRedactorOptions {
  /** True to replace PII with vault tokens; false to leave in place. */
  enabled?: boolean;
  /** Optional custom patterns to add. */
  extraPatterns?: Array<{ name: string; regex: RegExp; token?: string }>;
  /** Optional secure vault for encrypted storage. */
  vault?: SecureVault;
}

const BUILTIN_PATTERNS: Array<{ name: string; regex: RegExp; normalize?: (s: string) => string }> = [
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi },
  { name: 'phone', regex: /\b(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'credit_card', regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, normalize: (s) => s.replace(/[-\s]/g, '') },
  { name: 'api_key', regex: /\b(?:sk|api[_-]?key|apikey|token|passwd|password)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}["']?\b/gi },
];

export class PiiRedactor {
  private enabled: boolean;
  private patterns: Array<{ name: string; regex: RegExp; normalize?: (s: string) => string }>;
  private vault?: SecureVault;

  constructor(options: PiiRedactorOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.patterns = [...BUILTIN_PATTERNS];
    if (options.extraPatterns) {
      for (const p of options.extraPatterns) {
        this.patterns.push({ name: p.name, regex: p.regex, normalize: (s) => s });
      }
    }
    this.vault = options.vault;
  }

  async redact(text: string): Promise<PiiRedactionResult> {
    if (!this.enabled || !text) return { redacted: text, tokens: {}, touched: false };
    let redacted = text;
    const tokens: Record<string, string> = {};
    let touched = false;

    for (const pattern of this.patterns) {
      const matches = [...redacted.matchAll(pattern.regex)];
      for (const match of matches) {
        const raw = match[0];
        if (!raw) continue;
        const normalized = pattern.normalize ? pattern.normalize(raw) : raw;
        const token = this.tokenize(pattern.name, normalized);
        tokens[token] = normalized;
        if (this.vault) {
          await this.vault.store(token, normalized, pattern.name);
        }
        redacted = redacted.replace(raw, token);
        touched = true;
      }
    }

    return { redacted, tokens, touched };
  }

  async restore(token: string): Promise<string | undefined> {
    if (!this.vault) return undefined;
    return (await this.vault.retrieve(token)) ?? undefined;
  }

  private tokenize(name: string, value: string): string {
    const hash = this.hash(value);
    return `{{VAULT:${name.toUpperCase()}:${hash}}}`;
  }

  private hash(value: string): string {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36).padStart(6, '0');
  }
}
