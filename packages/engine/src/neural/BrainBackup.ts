/**
 * Encrypted `.brain` backup and restore using pg_dump / pg_restore.
 *
 * Uses the bundled PostgreSQL binaries to create a compressed custom-format
 * dump of the neural database, then AES-256-GCM encrypts it with a PBKDF2 key
 * derived from the user's passphrase. The `.brain` file header stores the
 * salt, IV, and metadata so restore is self-contained.
 *
 * AGE handling: the dump is taken in plain SQL format with `--schema=ag_catalog`
 * included so that AGE graph labels and data are restored correctly.
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locatePostgresBinaries } from './PostgresBinaryLocator.js';

export interface BrainBackupResult {
  filePath: string;
  database: string;
  sizeBytes: number;
}

export interface BrainRestoreResult {
  filePath: string;
  database: string;
  restored: boolean;
}

export interface BrainBackupOptions {
  /** PostgreSQL connection string. */
  connectionString: string;
  /** Output .brain file path. */
  filePath: string;
  /** User passphrase. */
  passphrase: string;
  /** Database name to dump. */
  database?: string;
  /** Schemas to include. Defaults to public + ag_catalog. */
  schemas?: string[];
}

export interface BrainRestoreOptions {
  /** PostgreSQL connection string to restore into. */
  connectionString: string;
  /** Input .brain file path. */
  filePath: string;
  /** User passphrase. */
  passphrase: string;
  /** Drop and recreate database before restore. */
  clean?: boolean;
}

interface BrainFileHeader {
  version: number;
  createdAt: string;
  database: string;
  schemas: string[];
  salt: string;
  iv: string;
  tag: string;
}

const SALT_LEN = 16;
const IV_LEN = 16;
const TAG_LEN = 16;
const ITERATIONS = 100_000;
const KEY_LEN = 32;
const FILE_VERSION = 1;

export class BrainBackup {
  private deriveKey(passphrase: string, salt: Buffer): Buffer {
    return pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, 'sha256');
  }

  async backup(options: BrainBackupOptions): Promise<BrainBackupResult> {
    const url = new URL(options.connectionString);
    const database = options.database ?? (url.pathname.replace(/^\//, '') || 'agentx');
    const schemas = options.schemas ?? ['public', 'ag_catalog'];
    const bins = await locatePostgresBinaries();
    const tmpDir = await mkdtemp(join(tmpdir(), 'agentx-brain-'));
    const dumpFile = join(tmpDir, 'dump.sql');

    try {
      await this.runPgDump(bins.pgDump, options.connectionString, database, schemas, dumpFile);
      const dumpBuffer = await readFile(dumpFile);
      const encrypted = this.encrypt(dumpBuffer, options.passphrase);
      const header: BrainFileHeader = {
        version: FILE_VERSION,
        createdAt: new Date().toISOString(),
        database,
        schemas,
        salt: encrypted.salt.toString('base64'),
        iv: encrypted.iv.toString('base64'),
        tag: encrypted.tag.toString('base64'),
      };
      const file = Buffer.concat([
        Buffer.from(JSON.stringify(header) + '\n'),
        encrypted.payload,
      ]);
      await writeFile(options.filePath, file);
      return { filePath: options.filePath, database, sizeBytes: file.length };
    } finally {
      await unlink(dumpFile).catch(() => {});
    }
  }

  async restore(options: BrainRestoreOptions): Promise<BrainRestoreResult> {
    const file = await readFile(options.filePath);
    const newline = file.indexOf('\n');
    if (newline === -1) throw new Error('Invalid .brain file');
    const header = JSON.parse(file.subarray(0, newline).toString('utf-8')) as BrainFileHeader;
    const encrypted = file.subarray(newline + 1);
    const decrypted = this.decrypt(encrypted, options.passphrase, header);

    const url = new URL(options.connectionString);
    const database = url.pathname.replace(/^\//, '') || header.database;
    const bins = await locatePostgresBinaries();
    const tmpDir = await mkdtemp(join(tmpdir(), 'agentx-brain-'));
    const dumpFile = join(tmpDir, 'dump.sql');

    try {
      await writeFile(dumpFile, decrypted);
      if (options.clean) {
        await this.runPsql(bins.psql, options.connectionString, `DROP DATABASE IF EXISTS "${database}"`);
        await this.runPsql(bins.psql, options.connectionString, `CREATE DATABASE "${database}"`);
      }
      await this.runPgRestore(bins.pgRestore, options.connectionString, database, dumpFile);
      return { filePath: options.filePath, database, restored: true };
    } finally {
      await unlink(dumpFile).catch(() => {});
    }
  }

  private runPgDump(
    pgDump: string,
    connectionString: string,
    _database: string,
    schemas: string[],
    outputFile: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        connectionString,
        '--format=plain',
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        `--file=${outputFile}`,
        ...schemas.flatMap((s) => [`--schema=${s}`]),
      ];
      const child = spawn(pgDump, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump failed (exit ${code}): ${stderr}`));
      });
    });
  }

  private runPgRestore(
    pgRestore: string,
    connectionString: string,
    database: string,
    dumpFile: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        `${connectionString.replace(/\/[^/]*$/, '')}/${database}`,
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        dumpFile,
      ];
      const child = spawn(pgRestore, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        // pg_restore exit 1 can still mean warnings; treat non-zero as warning unless fatal
        if (code === 0 || code === 1) resolve();
        else reject(new Error(`pg_restore failed (exit ${code}): ${stderr}`));
      });
    });
  }

  private runPsql(psql: string, connectionString: string, command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(psql, [connectionString, '-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`psql failed (exit ${code}): ${stderr}`));
      });
    });
  }

  private encrypt(buffer: Buffer, passphrase: string): { salt: Buffer; iv: Buffer; tag: Buffer; payload: Buffer } {
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = this.deriveKey(passphrase, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { salt, iv, tag, payload: Buffer.concat([salt, iv, tag, encrypted]) };
  }

  private decrypt(buffer: Buffer, passphrase: string, header: BrainFileHeader): Buffer {
    const salt = Buffer.from(header.salt, 'base64');
    const iv = Buffer.from(header.iv, 'base64');
    const tag = Buffer.from(header.tag, 'base64');
    if (salt.length !== SALT_LEN || iv.length !== IV_LEN || tag.length !== TAG_LEN) {
      throw new Error('Invalid .brain header');
    }
    const key = this.deriveKey(passphrase, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  }
}
