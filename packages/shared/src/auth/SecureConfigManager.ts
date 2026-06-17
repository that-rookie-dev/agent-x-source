/**
 * Secure Config Manager
 * 
 * Extends the standard ConfigManager to encrypt/decrypt the config file
 * at rest using the Data Encryption Key (DEK) from the AuthManager.
 * 
 * Security Properties:
 * - Config file is encrypted with AES-256-GCM using the DEK
 * - API keys and provider credentials are never stored in plaintext
 * - If auth credentials are tampered, DEK is lost → config is unreadable
 * - Tampering with the encrypted config file is detected (GCM auth tag)
 * 
 * File Format:
 * {
 *   version: 1,
 *   encrypted: { ciphertext, iv, tag },
 *   checksum: "sha256 of plaintext" // for integrity verification
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { getConfigDir } from '../platform.js';
import type { AgentXConfig } from '../types/index.js';
import { encrypt, decrypt } from '../crypto.js';
import type { EncryptedData } from '../crypto.js';

export interface SecureConfigFile {
  version: number;
  encrypted: EncryptedData;
  checksum: string;
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.enc.json');
}

function computeChecksum(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export class SecureConfigManager {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? getConfigPath();
  }

  isConfigured(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Save config encrypted with the provided DEK.
   */
  save(config: AgentXConfig, dek: Buffer): void {
    const plaintext = JSON.stringify(config, null, 2);
    const encrypted = encrypt(plaintext, dek);
    const checksum = computeChecksum(plaintext);

    const secureFile: SecureConfigFile = {
      version: 1,
      encrypted,
      checksum,
    };

    const dir = dirname(this.configPath || getConfigPath());
    mkdirSync(dir, { recursive: true });
    
    const tmpPath = this.configPath + '.tmp.' + Date.now();
    writeFileSync(tmpPath, JSON.stringify(secureFile, null, 2), 'utf-8');
    writeFileSync(this.configPath, JSON.stringify(secureFile, null, 2), 'utf-8');
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  /**
   * Load and decrypt config using the provided DEK.
   * 
   * Throws if:
   * - Config file doesn't exist
   * - Decryption fails (wrong DEK or tampered data)
   * - Checksum doesn't match (file corruption)
   */
  load(dek: Buffer): AgentXConfig {
    if (!existsSync(this.configPath)) {
      throw new Error('Secure config not found. Run setup first.');
    }

    const raw = readFileSync(this.configPath, 'utf-8');
    const secureFile: SecureConfigFile = JSON.parse(raw);

    if (secureFile.version !== 1) {
      throw new Error(`Unsupported secure config version: ${secureFile.version}`);
    }

    let plaintext: string;
    try {
      plaintext = decrypt(secureFile.encrypted, dek);
    } catch {
      throw new Error(
        'Config decryption failed. The data encryption key may have been invalidated ' +
        'due to credential tampering. All encrypted data is permanently lost.'
      );
    }

    const checksum = computeChecksum(plaintext);
    if (checksum !== secureFile.checksum) {
      throw new Error(
        'Config integrity check failed. The config file has been tampered with. ' +
        'All encrypted data is permanently lost.'
      );
    }

    return JSON.parse(plaintext) as AgentXConfig;
  }

  /**
   * Check if config exists without decrypting.
   */
  exists(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Destroy the encrypted config file.
   * Use with extreme caution — this makes all config data permanently unrecoverable.
   */
  destroy(): void {
    if (existsSync(this.configPath)) {
      try { unlinkSync(this.configPath); } catch { /* ignore */ }
    }
  }
}

// Singleton instance
export const secureConfigManager = new SecureConfigManager();
