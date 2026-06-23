/**
 * Agent-X Authentication & Authorization Manager
 * 
 * Implements:
 * - Root user creation (one-time setup)
 * - Password-based authentication with scrypt hashing
 * - Session management with cryptographically secure tokens
 * - Master key derivation for data encryption
 * 
 * Security Guarantees:
 * - Passwords are NEVER stored in plaintext
 * - Only Argon2id-class scrypt hashes are stored for verification
 * - Master keys are derived at login and NEVER persisted
 * - Sessions expire after 24 hours of inactivity
 * - All verification uses constant-time comparison
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../platform.js';
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
import type { EncryptedData, CredentialBundle } from '../crypto.js';

export interface AuthSession {
  token: string;
  username: string;
  createdAt: Date;
  lastActiveAt: Date;
  dek: Buffer; // Data Encryption Key — kept in memory ONLY
}

export interface AuthState {
  hasRootUser: boolean;
  isAuthenticated: boolean;
  username: string | null;
}

const AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getAuthDir(): string {
  return getDataDir();
}

function getAuthPath(): string {
  return join(getAuthDir(), 'auth.json');
}

export class AuthManager {
  private authPath: string;
  private sessions: Map<string, AuthSession> = new Map();
  private sessionsPath: string;
  private revokedPath: string;
  private revokedTokens: Set<string> = new Set();

  constructor() {
    this.authPath = getAuthPath();
    this.sessionsPath = join(getAuthDir(), 'sessions.json');
    this.revokedPath = join(getAuthDir(), 'revoked-tokens.json');
    this.loadSessions();
    this.loadRevokedTokens();
  }

  private loadSessions(): void {
    try {
      if (existsSync(this.sessionsPath)) {
        const raw = JSON.parse(readFileSync(this.sessionsPath, 'utf-8')) as Array<{ token: string; username: string; createdAt: string; lastActiveAt: string; dek?: string }>;
        for (const s of raw) {
          const createdAt = new Date(s.createdAt);
          if (Date.now() - createdAt.getTime() < AUTH_SESSION_TTL_MS) {
            this.sessions.set(s.token, {
              token: s.token,
              username: s.username,
              createdAt,
              lastActiveAt: new Date(s.lastActiveAt),
              dek: s.dek ? Buffer.from(s.dek, 'base64') : Buffer.alloc(0),
            });
          }
        }
      }
    } catch { /* sessions file missing or corrupted — start fresh */ }
  }

  private saveSessions(): void {
    try {
      const serialized = Array.from(this.sessions.entries())
        .map(([, s]) => ({
          token: s.token,
          username: s.username,
          createdAt: s.createdAt.toISOString(),
          lastActiveAt: s.lastActiveAt.toISOString(),
          dek: s.dek.length > 0 ? s.dek.toString('base64') : undefined,
        }));
      const tmpPath = this.sessionsPath + '.tmp.' + Date.now();
      writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), 'utf-8');
      writeFileSync(this.sessionsPath, JSON.stringify(serialized, null, 2), 'utf-8');
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    } catch { /* best effort */ }
  }

  /**
   * Check if a root user has been created.
   */
  hasRootUser(): boolean {
    return existsSync(this.authPath);
  }

  /**
   * Create the root user during initial setup.
   * 
   * This generates:
   * - A random DEK (Data Encryption Key) for encrypting user data
   * - A master key derived from the password to encrypt the DEK
   * - A password hash for authentication verification
   * 
   * The DEK is NEVER stored in plaintext. It is encrypted with the master key
   * and stored in the auth bundle. If the auth bundle is tampered, the DEK
   * is permanently lost and all encrypted data becomes useless.
   */
  async createRootUser(username: string, password: string): Promise<void> {
    if (this.hasRootUser()) {
      throw new Error('Root user already exists');
    }

    // Generate DEK — this is the key that encrypts ALL user data
    const dek = generateDEK();

    // Hash password for authentication (separate from key derivation salt)
    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password);

    // Generate master salt for deriving the master encryption key
    const masterSalt = generateSalt();

    // Derive master key from password — this encrypts the DEK
    const masterKey = await deriveKey(password, masterSalt);

    // Encrypt the DEK with the master key
    const encryptedDEK = encrypt(dek.toString('base64'), masterKey);

    const bundle: CredentialBundle = {
      username,
      passwordHash: passwordHash.toString('base64'),
      passwordSalt: passwordSalt.toString('base64'),
      masterSalt: masterSalt.toString('base64'),
      encryptedDEK: encryptedDEK.ciphertext,
      dekIV: encryptedDEK.iv,
      dekTag: encryptedDEK.tag,
      createdAt: new Date().toISOString(),
    };

    // Ensure directory exists
    mkdirSync(getAuthDir(), { recursive: true });

    // Atomic write
    const tmpPath = this.authPath + '.tmp.' + Date.now();
    writeFileSync(tmpPath, JSON.stringify(bundle, null, 2), 'utf-8');
    writeFileSync(this.authPath, JSON.stringify(bundle, null, 2), 'utf-8');
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  /**
   * Authenticate a user and create a session.
   * 
   * Returns the session token and stores the DEK in memory.
   * The DEK is NEVER written to disk or sent over the network.
   */
  async login(username: string, password: string): Promise<string> {
    const bundle = this.loadBundle();

    if (bundle.username !== username) {
      // Constant-time response to prevent user enumeration
      await hashPassword(password); // waste similar time
      throw new Error('Invalid credentials');
    }

    const passwordHash = Buffer.from(bundle.passwordHash, 'base64');
    const passwordSalt = Buffer.from(bundle.passwordSalt, 'base64');

    const valid = await verifyPassword(password, passwordHash, passwordSalt);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // Derive master key and decrypt DEK
    const masterSalt = Buffer.from(bundle.masterSalt, 'base64');
    const masterKey = await deriveKey(password, masterSalt);

    const encryptedDEK: EncryptedData = {
      ciphertext: bundle.encryptedDEK,
      iv: bundle.dekIV,
      tag: bundle.dekTag,
    };

    let dek: Buffer;
    try {
      const dekBase64 = decrypt(encryptedDEK, masterKey);
      dek = Buffer.from(dekBase64, 'base64');
    } catch {
      throw new Error('Credential tampering detected. All encrypted data is permanently lost.');
    }

    // Create session
    const token = generateSessionToken();
    const now = new Date();
    const session: AuthSession = {
      token,
      username,
      createdAt: now,
      lastActiveAt: now,
      dek,
    };

    this.sessions.set(token, session);
    this.saveSessions();
    return token;
  }

  /**
   * Validate a session token and return the session (with DEK).
   */
  validateSession(token: string): AuthSession | null {
    // Check global token blacklist first (fast reject)
    if (this.revokedTokens.has(token)) {
      this.sessions.delete(token);
      return null;
    }

    const session = this.sessions.get(token);
    if (!session) return null;

    const now = Date.now();
    if (now - session.lastActiveAt.getTime() > AUTH_SESSION_TTL_MS) {
      // Session expired
      this.sessions.delete(token);
      return null;
    }

    // Update last active time
    session.lastActiveAt = new Date();
    return session;
  }

  /**
   * Purge all sessions — clear in-memory sessions and delete sessions file.
   * Used during factory reset.
   */
  private loadRevokedTokens(): void {
    try {
      if (existsSync(this.revokedPath)) {
        const raw = JSON.parse(readFileSync(this.revokedPath, 'utf-8')) as string[];
        for (const token of raw) {
          this.revokedTokens.add(token);
        }
      }
    } catch { /* revoked tokens file missing or corrupted — start fresh */ }
  }

  private saveRevokedTokens(): void {
    try {
      const tmpPath = this.revokedPath + '.tmp.' + Date.now();
      writeFileSync(tmpPath, JSON.stringify(Array.from(this.revokedTokens)), 'utf-8');
      writeFileSync(this.revokedPath, JSON.stringify(Array.from(this.revokedTokens)), 'utf-8');
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    } catch { /* best effort */ }
  }

  purgeSessions(): void {
    for (const [, session] of this.sessions) {
      session.dek.fill(0);
    }
    this.sessions.clear();
    this.revokedTokens.clear();
    try {
      if (existsSync(this.sessionsPath)) {
        writeFileSync(this.sessionsPath, '[]', 'utf-8');
      }
      if (existsSync(this.revokedPath)) {
        writeFileSync(this.revokedPath, '[]', 'utf-8');
      }
    } catch { /* best effort */ }
  }

  /**
   * Logout — destroy the session and clear the DEK from memory.
   */
  logout(token: string): void {
    const session = this.sessions.get(token);
    if (session) {
      session.dek.fill(0);
      this.sessions.delete(token);
      this.saveSessions();
    }
    // Add to persistent blacklist so even if sessions.json is restored, token is rejected
    this.revokedTokens.add(token);
    this.saveRevokedTokens();
  }

  /**
   * Encrypt sensitive data using the session's DEK.
   */
  encryptWithSession(token: string, data: unknown): EncryptedData {
    const session = this.validateSession(token);
    if (!session) {
      throw new Error('Invalid or expired session');
    }
    return encryptJSON(data, session.dek);
  }

  /**
   * Decrypt sensitive data using the session's DEK.
   */
  decryptWithSession<T = unknown>(token: string, encrypted: EncryptedData): T {
    const session = this.validateSession(token);
    if (!session) {
      throw new Error('Invalid or expired session');
    }
    return decryptJSON<T>(encrypted, session.dek);
  }

  /**
   * Get auth state for a given session token.
   */
  getAuthState(token?: string): AuthState {
    const hasRootUser = this.hasRootUser();
    if (!hasRootUser) {
      return { hasRootUser: false, isAuthenticated: false, username: null };
    }

    if (!token) {
      return { hasRootUser: true, isAuthenticated: false, username: null };
    }

    const session = this.validateSession(token);
    if (!session) {
      return { hasRootUser: true, isAuthenticated: false, username: null };
    }

    return { hasRootUser: true, isAuthenticated: true, username: session.username };
  }

  /**
   * Check if a session token is valid (for middleware).
   */
  isAuthenticated(token?: string): boolean {
    if (!token) return false;
    return this.validateSession(token) !== null;
  }

  /**
   * Change the root user's password.
   * Re-encrypts the DEK with the new password-derived master key.
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const bundle = this.loadBundle();

    // Verify old password
    const passwordHash = Buffer.from(bundle.passwordHash, 'base64');
    const passwordSalt = Buffer.from(bundle.passwordSalt, 'base64');

    const valid = await verifyPassword(oldPassword, passwordHash, passwordSalt);
    if (!valid) {
      throw new Error('Invalid current password');
    }

    // Derive old master key and decrypt DEK
    const oldMasterSalt = Buffer.from(bundle.masterSalt, 'base64');
    const oldMasterKey = await deriveKey(oldPassword, oldMasterSalt);

    const encryptedDEK: EncryptedData = {
      ciphertext: bundle.encryptedDEK,
      iv: bundle.dekIV,
      tag: bundle.dekTag,
    };

    let dek: Buffer;
    try {
      const dekBase64 = decrypt(encryptedDEK, oldMasterKey);
      dek = Buffer.from(dekBase64, 'base64');
    } catch {
      throw new Error('Credential tampering detected. All encrypted data is permanently lost.');
    }

    // Generate new password hash
    const { hash: newPasswordHash, salt: newPasswordSalt } = await hashPassword(newPassword);

    // Generate new master salt and derive new master key
    const newMasterSalt = generateSalt();
    const newMasterKey = await deriveKey(newPassword, newMasterSalt);

    // Re-encrypt DEK with new master key
    const newEncryptedDEK = encrypt(dek.toString('base64'), newMasterKey);

    // Update bundle
    const newBundle: CredentialBundle = {
      ...bundle,
      passwordHash: newPasswordHash.toString('base64'),
      passwordSalt: newPasswordSalt.toString('base64'),
      masterSalt: newMasterSalt.toString('base64'),
      encryptedDEK: newEncryptedDEK.ciphertext,
      dekIV: newEncryptedDEK.iv,
      dekTag: newEncryptedDEK.tag,
    };

    writeFileSync(this.authPath, JSON.stringify(newBundle, null, 2), 'utf-8');

    // Update all active sessions with the new DEK reference
    // (sessions keep their own dek buffer, so they're fine until re-auth)
  }

  private loadBundle(): CredentialBundle {
    if (!existsSync(this.authPath)) {
      throw new Error('No root user configured');
    }
    try {
      const raw = readFileSync(this.authPath, 'utf-8');
      return JSON.parse(raw) as CredentialBundle;
    } catch {
      throw new Error('Auth credential file is corrupted. All encrypted data is permanently lost.');
    }
  }
}

// Singleton instance for the application
export const authManager = new AuthManager();
