import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encrypt, decrypt } from '@agentx/shared';
import { randomBytes } from 'node:crypto';

interface EncryptedStore<T> {
  __encrypted: true;
  version: string;
  salt: string;
  iv: string;
  data: string;
  _plaintext?: T;
}

/**
 * SecureStore provides encrypted storage for sensitive configuration data.
 * Uses AES-256-CBC encryption with a machine-specific key derived from the
 * system hostname and config directory path.
 */
export class SecureStore<T> {
  private configPath: string;
  private encryptionKey: Buffer;

  constructor(configDir: string, filename: string) {
    this.configPath = join(configDir, filename);
    
    // Derive encryption key from machine-specific data
    const hostname = process.env.HOSTNAME || 'agentx-default';
    const keyMaterial = `${hostname}:${configDir}:agentx-secure-store`;
    this.encryptionKey = Buffer.from(keyMaterial).subarray(0, 32);
    
    // Ensure directory exists
    mkdirSync(configDir, { recursive: true });
  }

  save(data: T): void {
    try {
      const plaintext = JSON.stringify(data);
      const salt = randomBytes(16);
      const iv = randomBytes(16);
      
      const encrypted = encrypt(plaintext, this.encryptionKey);
      
      const store: EncryptedStore<T> = {
        __encrypted: true,
        version: '1.0',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        data: JSON.stringify(encrypted),
      };
      
      writeFileSync(this.configPath, JSON.stringify(store, null, 2));
    } catch (error) {
      throw new Error(`Failed to save encrypted config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  load(): T | null {
    if (!existsSync(this.configPath)) return null;
    
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      
      // Check if it's an encrypted store
      if (parsed.__encrypted === true) {
        const encryptedData = parsed.data;
        const plaintext = decrypt(encryptedData, this.encryptionKey);
        return JSON.parse(plaintext) as T;
      }
      
      // Legacy plaintext format - migrate on next save
      console.warn(`[SecureStore] Found unencrypted config at ${this.configPath}. Will encrypt on next save.`);
      return parsed as T;
    } catch (error) {
      console.error(`[SecureStore] Failed to load config from ${this.configPath}:`, error);
      return null;
    }
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    if (existsSync(this.configPath)) {
      writeFileSync(this.configPath, '{}');
    }
  }

  /**
   * Migrate legacy plaintext configs to encrypted format
   */
  migrateLegacy(): boolean {
    const data = this.load();
    if (data !== null) {
      this.save(data);
      return true;
    }
    return false;
  }
}
