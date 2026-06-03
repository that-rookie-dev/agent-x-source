#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
const versionPath = join(__dirname, '..', '..', 'shared', 'src', 'constants', 'version.ts');

const versionSrc = readFileSync(versionPath, 'utf8');
const match = versionSrc.match(/export const VERSION = '([^']+)'/);
if (!match) throw new Error('VERSION not found in shared constants');

const sharedVersion = match[1];
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

if (pkg.version !== sharedVersion) {
  pkg.version = sharedVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[sync-version] package.json: ${pkg.version} → ${sharedVersion}`);
} else {
  console.log(`[sync-version] Already at ${sharedVersion}`);
}
