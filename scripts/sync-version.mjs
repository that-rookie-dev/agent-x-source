#!/usr/bin/env node

/**
 * Sync version from the single source of truth (packages/shared/src/constants/version.ts)
 * to root package.json.
 *
 * Usage:
 *   node scripts/sync-version.mjs          # Sync version.ts → package.json
 *   node scripts/sync-version.mjs --check  # Check if they match (CI gate)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Read version from version.ts (single source of truth)
const versionTsPath = resolve(root, 'packages/shared/src/constants/version.ts');
const versionTs = readFileSync(versionTsPath, 'utf-8');
const match = versionTs.match(/VERSION\s*=\s*'([^']+)'/);
if (!match) {
  console.error('❌ Could not parse VERSION from packages/shared/src/constants/version.ts');
  process.exit(1);
}
const sourceVersion = match[1];

// Read version from root package.json
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const pkgVersion = pkg.version;

const checkOnly = process.argv.includes('--check');

if (sourceVersion === pkgVersion) {
  console.log(`✓ Version is in sync: ${sourceVersion}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`❌ Version mismatch!`);
  console.error(`   version.ts: ${sourceVersion}`);
  console.error(`   package.json: ${pkgVersion}`);
  console.error(`\n   Run "pnpm version:sync" to fix.`);
  process.exit(1);
}

// Sync: update package.json
pkg.version = sourceVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ Synced package.json version: ${pkgVersion} → ${sourceVersion}`);
