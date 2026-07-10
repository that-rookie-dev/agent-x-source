#!/usr/bin/env node

/**
 * Sync version from the single source of truth (packages/shared/src/constants/version.ts)
 * to package.json files and README docs that embed the release version.
 *
 * Usage:
 *   node scripts/sync-version.mjs          # Sync version.ts → package.json + README files
 *   node scripts/sync-version.mjs --check  # Check if they match (CI gate)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Read version from version.ts (single source of truth)
const versionTsPath = resolve(root, 'packages/shared/src/constants/version.ts');
const versionTs = readFileSync(versionTsPath, 'utf-8');
const match = versionTs.match(/VERSION\s*=\s*'([^']+)'/);
if (!match) {
  console.error('Could not parse VERSION from packages/shared/src/constants/version.ts');
  process.exit(1);
}
const sourceVersion = match[1];
const sourceTag = `v${sourceVersion}`;

const checkOnly = process.argv.includes('--check');

/** README files (relative to monorepo root) that use __AGENTX_TAG__ / __AGENTX_VERSION__ placeholders. */
const readmePaths = [
  resolve(root, '..', 'release', 'README.md'),
];

function syncReadmeContent(content) {
  let updated = content
    .replace(/__AGENTX_TAG__/g, sourceTag)
    .replace(/__AGENTX_VERSION__/g, sourceVersion)
    .replace(/AGENTX_VERSION=v\d+\.\d+\.\d+/g, `AGENTX_VERSION=${sourceTag}`)
    .replace(/\*\*Current release:\*\* v\d+\.\d+\.\d+/g, `**Current release:** ${sourceTag}`);

  return updated;
}

function readmeNeedsSync(content) {
  if (content.includes('__AGENTX_TAG__') || content.includes('__AGENTX_VERSION__')) {
    return true;
  }
  if (!content.includes(`AGENTX_VERSION=${sourceTag}`)) {
    return true;
  }
  if (content.includes('**Current release:**') && !content.includes(`**Current release:** ${sourceTag}`)) {
    return true;
  }
  return false;
}

// All package.json files that must stay in sync
const pkgPaths = [
  resolve(root, 'package.json'),
  resolve(root, 'packages/desktop/package.json'),
];

let mismatch = false;

for (const pkgPath of pkgPaths) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const pkgVersion = pkg.version;

  if (sourceVersion === pkgVersion) {
    console.log(`  ${pkgPath.replace(root, '')} : ${sourceVersion}`);
  } else {
    mismatch = true;
    if (checkOnly) {
      console.error(`  ${pkgPath.replace(root, '')} : ${pkgVersion} (expected ${sourceVersion})`);
    } else {
      pkg.version = sourceVersion;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`  ${pkgPath.replace(root, '')} : ${pkgVersion} -> ${sourceVersion}`);
    }
  }
}

for (const readmePath of readmePaths) {
  if (!existsSync(readmePath)) {
    continue;
  }

  const label = readmePath.replace(resolve(root, '..'), '');
  const content = readFileSync(readmePath, 'utf-8');
  const synced = syncReadmeContent(content);
  const needsUpdate = readmeNeedsSync(content);

  if (!needsUpdate) {
    console.log(`  ${label} : ${sourceTag}`);
    continue;
  }

  mismatch = true;
  if (checkOnly) {
    console.error(`  ${label} : out of date (expected ${sourceTag})`);
  } else {
    writeFileSync(readmePath, synced);
    console.log(`  ${label} : synced -> ${sourceTag}`);
  }
}

if (checkOnly && mismatch) {
  console.error('\nVersion mismatch! Run "pnpm version:sync" to fix.');
  process.exit(1);
}

if (!checkOnly && !mismatch) {
  console.log(`\nAll versions in sync at ${sourceTag}`);
}
