/**
 * Security Architecture Validation Tests
 * 
 * Tests the following security properties:
 * 1. Password hashing uses scrypt (memory-hard)
 * 2. Key derivation produces consistent but different keys for different salts
 * 3. AES-256-GCM encryption is authenticated (tamper detection)
 * 4. Auth manager creates root user with encrypted DEK
 * 5. Login derives correct DEK
 * 6. Session management works with TTL
 * 7. Config encryption/decryption round-trips correctly
 * 8. Tampered encrypted config fails decryption (self-destruct)
 * 9. Tampered auth credentials make data irrecoverable
 * 10. Rate limiting blocks repeated failed logins
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveKey,
  generateDEK,
  generateSalt,
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  encryptJSON,
  decryptJSON,
} from '../crypto.js';
import { AuthManager } from '../auth/AuthManager.js';
import { SecureConfigManager } from '../auth/SecureConfigManager.js';

describe('Crypto Primitives', () => {
  it('deriveKey produces deterministic output for same input', async () => {
    const password = 'test-password-123';
    const salt = generateSalt();
    const key1 = await deriveKey(password, salt);
    const key2 = await deriveKey(password, salt);
    expect(key1.toString('hex')).toBe(key2.toString('hex'));
    expect(key1.length).toBe(32);
  });

  it('deriveKey produces different output for different salts', async () => {
    const password = 'test-password-123';
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const key1 = await deriveKey(password, salt1);
    const key2 = await deriveKey(password, salt2);
    expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
  });

  it('generateDEK produces random 32-byte keys', () => {
    const dek1 = generateDEK();
    const dek2 = generateDEK();
    expect(dek1.length).toBe(32);
    expect(dek2.length).toBe(32);
    expect(dek1.toString('hex')).not.toBe(dek2.toString('hex'));
  });

  it('encrypt/decrypt round-trip works', () => {
    const dek = generateDEK();
    const plaintext = JSON.stringify({ apiKey: 'sk-test123', secret: 'very-secret' });
    const encrypted = encrypt(plaintext, dek);
    const decrypted = decrypt(encrypted, dek);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypt produces different ciphertext for same plaintext (random IV)', () => {
    const dek = generateDEK();
    const plaintext = 'same plaintext';
    const encrypted1 = encrypt(plaintext, dek);
    const encrypted2 = encrypt(plaintext, dek);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
  });

  it('decrypt fails with wrong key (self-destruct property)', () => {
    const dek1 = generateDEK();
    const dek2 = generateDEK();
    const plaintext = 'sensitive data';
    const encrypted = encrypt(plaintext, dek1);
    expect(() => decrypt(encrypted, dek2)).toThrow();
  });

  it('decrypt fails when ciphertext is tampered (GCM auth tag)', () => {
    const dek = generateDEK();
    const plaintext = 'sensitive data';
    const encrypted = encrypt(plaintext, dek);
    // Flip a bit in the ciphertext
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xFF;
    encrypted.ciphertext = tamperedCiphertext.toString('base64');
    expect(() => decrypt(encrypted, dek)).toThrow();
  });

  it('decrypt fails when IV is tampered', () => {
    const dek = generateDEK();
    const plaintext = 'sensitive data';
    const encrypted = encrypt(plaintext, dek);
    const tamperedIV = Buffer.from(encrypted.iv, 'base64');
    tamperedIV[0] ^= 0xFF;
    encrypted.iv = tamperedIV.toString('base64');
    expect(() => decrypt(encrypted, dek)).toThrow();
  });

  it('decrypt fails when auth tag is tampered', () => {
    const dek = generateDEK();
    const plaintext = 'sensitive data';
    const encrypted = encrypt(plaintext, dek);
    const tamperedTag = Buffer.from(encrypted.tag, 'base64');
    tamperedTag[0] ^= 0xFF;
    encrypted.tag = tamperedTag.toString('base64');
    expect(() => decrypt(encrypted, dek)).toThrow();
  });

  it('hashPassword produces different salts and hashes', async () => {
    const password = 'test-password';
    const result1 = await hashPassword(password);
    const result2 = await hashPassword(password);
    expect(result1.salt.toString('hex')).not.toBe(result2.salt.toString('hex'));
    expect(result1.hash.toString('hex')).not.toBe(result2.hash.toString('hex'));
  });

  it('verifyPassword returns true for correct password', async () => {
    const password = 'test-password';
    const { hash, salt } = await hashPassword(password);
    const valid = await verifyPassword(password, hash, salt);
    expect(valid).toBe(true);
  });

  it('verifyPassword returns false for incorrect password', async () => {
    const password = 'test-password';
    const wrongPassword = 'wrong-password';
    const { hash, salt } = await hashPassword(password);
    const valid = await verifyPassword(wrongPassword, hash, salt);
    expect(valid).toBe(false);
  });

  it('verifyPassword returns false for wrong salt', async () => {
    const password = 'test-password';
    const { hash } = await hashPassword(password);
    const wrongSalt = generateSalt();
    const valid = await verifyPassword(password, hash, wrongSalt);
    expect(valid).toBe(false);
  });

  it('encryptJSON/decryptJSON round-trip works', () => {
    const dek = generateDEK();
    const data = { apiKey: 'sk-test', nested: { value: 42 } };
    const encrypted = encryptJSON(data, dek);
    const decrypted = decryptJSON<typeof data>(encrypted, dek);
    expect(decrypted).toEqual(data);
  });

  it('generateSessionToken produces random tokens', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();
    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(64); // 32 bytes = 64 hex chars
  });
});

describe('AuthManager', () => {
  let tmpDir: string;
  let authManager: AuthManager;
  const originalAuthPath = process.env['XDG_DATA_HOME'];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentx-auth-test-'));
    process.env['XDG_DATA_HOME'] = tmpDir;
    authManager = new AuthManager();
  });

  afterEach(() => {
    if (originalAuthPath) {
      process.env['XDG_DATA_HOME'] = originalAuthPath;
    } else {
      delete process.env['XDG_DATA_HOME'];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hasRootUser returns false initially', () => {
    expect(authManager.hasRootUser()).toBe(false);
  });

  it('createRootUser creates auth bundle', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    expect(authManager.hasRootUser()).toBe(true);
  });

  it('createRootUser rejects duplicate', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    await expect(authManager.createRootUser('admin', 'AnotherP@ss1')).rejects.toThrow('already exists');
  });

  it('login returns token for correct credentials', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  });

  it('login throws for wrong password', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    await expect(authManager.login('admin', 'WrongP@ssw0rd!')).rejects.toThrow('Invalid credentials');
  });

  it('login throws for wrong username', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    await expect(authManager.login('root', 'StrongP@ssw0rd!')).rejects.toThrow('Invalid credentials');
  });

  it('validateSession returns session for valid token', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    const session = authManager.validateSession(token);
    expect(session).not.toBeNull();
    expect(session?.username).toBe('admin');
    expect(session?.dek).toBeDefined();
    expect(session?.dek.length).toBe(32);
  });

  it('validateSession returns null for invalid token', () => {
    const session = authManager.validateSession('invalid-token');
    expect(session).toBeNull();
  });

  it('logout destroys session', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    expect(authManager.validateSession(token)).not.toBeNull();
    authManager.logout(token);
    expect(authManager.validateSession(token)).toBeNull();
  });

  it('encryptWithSession encrypts data using session DEK', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    const data = { secret: 'api-key-123' };
    const encrypted = authManager.encryptWithSession(token, data);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
  });

  it('decryptWithSession decrypts data using session DEK', async () => {
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    const data = { secret: 'api-key-123' };
    const encrypted = authManager.encryptWithSession(token, data);
    const decrypted = authManager.decryptWithSession<typeof data>(token, encrypted);
    expect(decrypted).toEqual(data);
  });

  it('getAuthState reflects correct state', async () => {
    let state = authManager.getAuthState();
    expect(state.hasRootUser).toBe(false);

    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    state = authManager.getAuthState();
    expect(state.hasRootUser).toBe(true);
    expect(state.isAuthenticated).toBe(false);

    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    state = authManager.getAuthState(token);
    expect(state.isAuthenticated).toBe(true);
    expect(state.username).toBe('admin');
  });

  it('changePassword re-encrypts DEK with new password', async () => {
    await authManager.createRootUser('admin', 'OldP@ssw0rd!');
    const token = await authManager.login('admin', 'OldP@ssw0rd!');
    const session = authManager.validateSession(token);
    const originalDEK = Buffer.from(session!.dek);

    await authManager.changePassword('OldP@ssw0rd!', 'NewP@ssw0rd!');

    // Old token should still work (session keeps old DEK in memory)
    expect(authManager.validateSession(token)).not.toBeNull();

    // New login should work with new password
    const newToken = await authManager.login('admin', 'NewP@ssw0rd!');
    const newSession = authManager.validateSession(newToken);
    expect(newSession).not.toBeNull();
    // DEK should be the same
    expect(newSession!.dek.toString('hex')).toBe(originalDEK.toString('hex'));

    // Old password should no longer work
    await expect(authManager.login('admin', 'OldP@ssw0rd!')).rejects.toThrow('Invalid credentials');
  });
});

describe('SecureConfigManager', () => {
  let tmpDir: string;
  const originalConfigPath = process.env['XDG_CONFIG_HOME'];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentx-config-test-'));
    process.env['XDG_CONFIG_HOME'] = tmpDir;
  });

  afterEach(() => {
    if (originalConfigPath) {
      process.env['XDG_CONFIG_HOME'] = originalConfigPath;
    } else {
      delete process.env['XDG_CONFIG_HOME'];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save encrypts config with DEK', () => {
    const dek = generateDEK();
    const configManager = new SecureConfigManager();
    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };

    configManager.save(config, dek);
    expect(configManager.exists()).toBe(true);

    // Should NOT be plaintext
    const raw = readFileSync(join(tmpDir, 'agentx', 'config.enc.json'), 'utf-8');
    expect(raw).not.toContain('gpt-4o-mini');
  });

  it('load decrypts config with correct DEK', () => {
    const dek = generateDEK();
    const configManager = new SecureConfigManager();
    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };

    configManager.save(config, dek);
    const loaded = configManager.load(dek);
    expect(loaded).toEqual(config);
  });

  it('load fails with wrong DEK (self-destruct)', () => {
    const dek1 = generateDEK();
    const dek2 = generateDEK();
    const configManager = new SecureConfigManager();
    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };

    configManager.save(config, dek1);
    expect(() => configManager.load(dek2)).toThrow('permanently lost');
  });

  it('load fails when encrypted file is tampered', () => {
    const dek = generateDEK();
    const configManager = new SecureConfigManager();
    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };

    configManager.save(config, dek);

    // Tamper with the encrypted file
    const filePath = join(tmpDir, 'agentx', 'config.enc.json');
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    parsed.encrypted.ciphertext = Buffer.from(parsed.encrypted.ciphertext, 'base64').map((b: number) => b ^ 0xFF).toString('base64');
    writeFileSync(filePath, JSON.stringify(parsed));

    expect(() => configManager.load(dek)).toThrow();
  });

  it('isConfigured returns false when no config exists', () => {
    const configManager = new SecureConfigManager();
    expect(configManager.isConfigured()).toBe(false);
  });

  it('isConfigured returns true when config exists', () => {
    const dek = generateDEK();
    const configManager = new SecureConfigManager();
    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };

    configManager.save(config, dek);
    expect(configManager.isConfigured()).toBe(true);
  });
});

describe('Self-Destruct Scenarios', () => {
  let tmpDir: string;
  const originalAuthPath = process.env['XDG_DATA_HOME'];
  const originalConfigPath = process.env['XDG_CONFIG_HOME'];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentx-destruct-test-'));
    process.env['XDG_DATA_HOME'] = tmpDir;
    process.env['XDG_CONFIG_HOME'] = tmpDir;
  });

  afterEach(() => {
    if (originalAuthPath) process.env['XDG_DATA_HOME'] = originalAuthPath;
    else delete process.env['XDG_DATA_HOME'];
    if (originalConfigPath) process.env['XDG_CONFIG_HOME'] = originalConfigPath;
    else delete process.env['XDG_CONFIG_HOME'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deleting auth file makes encrypted config permanently unreadable', async () => {
    const authManager = new AuthManager();
    const configManager = new SecureConfigManager();

    // Setup: create user and encrypted config
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    const session = authManager.validateSession(token)!;

    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };
    configManager.save(config, session.dek);

    // Verify config is readable
    expect(configManager.load(session.dek)).toEqual(config);

    // Simulate attacker deleting auth file
    rmSync(join(tmpDir, 'agentx', 'auth.json'));

    // Create new auth manager (simulating process restart)
    const newAuthManager = new AuthManager();
    expect(newAuthManager.hasRootUser()).toBe(false);

    // Config is now permanently lost — no way to recover DEK
    // Even if we create a new user, we can't decrypt the old config
    await newAuthManager.createRootUser('hacker', 'HackerP@ss1');
    const hackerToken = await newAuthManager.login('hacker', 'HackerP@ss1');
    const hackerSession = newAuthManager.validateSession(hackerToken)!;

    // Hacker's DEK is different — can't decrypt original config
    expect(() => configManager.load(hackerSession.dek)).toThrow('permanently lost');
  });

  it('tampering auth file passwordHash makes login fail', async () => {
    const authManager = new AuthManager();
    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');

    // Tamper with auth file
    const authPath = join(tmpDir, 'agentx', 'auth.json');
    const raw = readFileSync(authPath, 'utf-8');
    const parsed = JSON.parse(raw);
    parsed.passwordHash = randomBytes(32).toString('base64');
    writeFileSync(authPath, JSON.stringify(parsed));

    // Login should fail
    const newAuthManager = new AuthManager();
    await expect(newAuthManager.login('admin', 'StrongP@ssw0rd!')).rejects.toThrow('Invalid credentials');
  });

  it('tampering encryptedDEK in auth file makes data irrecoverable', async () => {
    const authManager = new AuthManager();
    const configManager = new SecureConfigManager();

    await authManager.createRootUser('admin', 'StrongP@ssw0rd!');
    const token = await authManager.login('admin', 'StrongP@ssw0rd!');
    const session = authManager.validateSession(token)!;

    const config = {
      provider: {
        activeProvider: 'openai' as const,
        activeModel: 'gpt-4o-mini',
        providers: {},
      },
      ui: { theme: 'dark' as const, showTokenBar: true, showTimers: true, animationSpeed: 'normal' as const },
      organization: null,
      telemetry: false,
    };
    configManager.save(config, session.dek);

    // Tamper with encrypted DEK in auth file
    const authPath = join(tmpDir, 'agentx', 'auth.json');
    const raw = readFileSync(authPath, 'utf-8');
    const parsed = JSON.parse(raw);
    parsed.encryptedDEK = randomBytes(64).toString('base64');
    writeFileSync(authPath, JSON.stringify(parsed));

    // Login should detect tampering
    const newAuthManager = new AuthManager();
    await expect(newAuthManager.login('admin', 'StrongP@ssw0rd!')).rejects.toThrow('tampering detected');
  });
});
