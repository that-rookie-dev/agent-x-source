/**
 * High-End Cryptographic Primitives for Agent-X
 * 
 * Security Architecture:
 * - Scrypt for memory-hard key derivation (resistant to GPU/ASIC attacks)
 * - AES-256-GCM for authenticated encryption (confidentiality + integrity)
 * - Random IV per encryption operation
 * - Timing-safe comparison for all verification operations
 * 
 * Self-Destruct Property:
 * The Data Encryption Key (DEK) is randomly generated and encrypted with
 * a master key derived from the user's password. The DEK is NEVER stored
 * in plaintext. If the auth credential file is tampered or deleted,
 * the DEK becomes permanently irrecoverable, rendering all encrypted
 * user data (API keys, configs, sessions) cryptographically useless.
 */

import { scrypt, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

// Security parameters
const SCRYPT_N = 32768; // CPU/memory cost (2^15) — high enough to resist brute force
const SCRYPT_R = 8;     // Block size
const SCRYPT_P = 1;     // Parallelization
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 16;   // 128 bits for GCM
const TAG_LENGTH = 16;  // 128 bits GCM auth tag
const SALT_LENGTH = 32; // 256 bits

export interface EncryptedData {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
}

export interface CredentialBundle {
  username: string;
  passwordHash: string; // base64 — scrypt hash for authentication
  passwordSalt: string; // base64
  masterSalt: string;   // base64 — salt for deriving master key
  encryptedDEK: string; // base64 — DEK encrypted with master key
  dekIV: string;        // base64
  dekTag: string;       // base64
  createdAt: string;
}

/**
 * Promisified scrypt with explicit options support.
 * maxmem is set to 64MB to accommodate N=32768, r=8, p=1
 * which requires ~33MB of memory.
 */
function scryptPromise(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { ...options, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Derive a 256-bit key from password + salt using scrypt.
 * Scrypt is memory-hard, making brute-force attacks extremely expensive.
 */
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scryptPromise(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/**
 * Generate a cryptographically secure random Data Encryption Key.
 */
export function generateDEK(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Generate a random salt.
 */
export function generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH);
}

/**
 * Generate a random initialization vector.
 */
export function generateIV(): Buffer {
  return randomBytes(IV_LENGTH);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns ciphertext, IV, and authentication tag.
 * 
 * The auth tag ensures tampering is detected during decryption.
 * If even a single bit is flipped in the ciphertext, decryption will fail.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedData {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH}, got ${key.length}`);
  }

  const iv = generateIV();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
  ciphertext += cipher.final('base64');
  
  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 * 
 * CRITICAL: If the auth tag verification fails (tampering detected),
 * this throws an error and the data is effectively destroyed.
 * This is the "self-destruct" property — tampered data becomes useless.
 */
export function decrypt(encrypted: EncryptedData, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH}, got ${key.length}`);
  }

  const iv = Buffer.from(encrypted.iv, 'base64');
  const tag = Buffer.from(encrypted.tag, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${TAG_LENGTH}, got ${tag.length}`);
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
  plaintext += decipher.final('utf-8');

  return plaintext;
}

/**
 * Hash a password for authentication verification.
 * Uses scrypt with a unique salt per user.
 * 
 * This hash is stored and used ONLY for login verification.
 * It is NOT used for data encryption.
 */
export async function hashPassword(password: string): Promise<{ hash: Buffer; salt: Buffer }> {
  const salt = generateSalt();
  const hash = await deriveKey(password, salt);
  return { hash, salt };
}

/**
 * Verify a password against a stored hash using constant-time comparison.
 * 
 * timingSafeEqual prevents timing attacks that could leak information
 * about the password hash through side channels.
 */
export async function verifyPassword(password: string, hash: Buffer, salt: Buffer): Promise<boolean> {
  const candidate = await deriveKey(password, salt);
  
  if (candidate.length !== hash.length) {
    return false;
  }

  try {
    return timingSafeEqual(candidate, hash);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure random session token.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Serialize an object to JSON and encrypt it.
 */
export function encryptJSON(data: unknown, key: Buffer): EncryptedData {
  return encrypt(JSON.stringify(data), key);
}

/**
 * Decrypt and parse JSON.
 */
export function decryptJSON<T = unknown>(encrypted: EncryptedData, key: Buffer): T {
  const plaintext = decrypt(encrypted, key);
  return JSON.parse(plaintext) as T;
}
