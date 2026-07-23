#!/usr/bin/env node
/**
 * Copy runtime dependencies with native modules into the web-api dist folder.
 *
 * The web-api bundle is self-contained (noExternal), but packages that load
 * native .node binaries via relative paths must be left external and shipped
 * as real packages next to the bundle. This script resolves those packages and
 * their production dependencies from the pnpm workspace and copies them into
 * dist/node_modules.
 */
import { readFileSync, cpSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const targetModulesDir = join(distDir, 'node_modules');
const webApiDir = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Packages that are externalized in tsup.config.ts because they load native
// binaries or use runtime dynamic imports that can't be bundled.
const externalPackages = [
  'onnxruntime-node',
  'onnxruntime-web',
  'onnxruntime-common',
  'pdfjs-dist',
  '@napi-rs/keyring',
  '@napi-rs/canvas',
  'esbuild',
];

const copied = new Set();

function storeEntryPrefix(pkgName) {
  return pkgName.startsWith('@') ? `${pkgName.replace('/', '+')}@` : `${pkgName}@`;
}

function findInPnpmStore(pkgName) {
  const pnpmStore = join(workspaceRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmStore)) return null;
  const prefix = storeEntryPrefix(pkgName);
  for (const entry of readdirSync(pnpmStore)) {
    if (!entry.startsWith(prefix)) continue;
    const src = pkgName.startsWith('@')
      ? join(pnpmStore, entry, 'node_modules', ...pkgName.split('/'))
      : join(pnpmStore, entry, 'node_modules', pkgName);
    if (existsSync(src)) return src;
  }
  return null;
}

function packageDirLooksComplete(dir) {
  return existsSync(join(dir, 'package.json'));
}

function resolvePackageDir(name, lookupPaths) {
  try {
    const basePath = lookupPaths[0] ?? fileURLToPath(new URL('..', import.meta.url));
    const req = createRequire(join(basePath, 'package.json'));
    const entry = req.resolve(name);
    let dir = dirname(entry);
    let root = null;
    // Walk all the way up; the topmost package.json with the matching name is the package root.
    while (dir !== dirname(dir)) {
      const pkgJsonPath = join(dir, 'package.json');
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
          if (pkg.name === name) {
            root = dir;
          }
        } catch {
          // continue walking
        }
      }
      dir = dirname(dir);
    }
    return root;
  } catch {
    return null;
  }
}

function copyPackage(name, lookupPaths) {
  if (copied.has(name)) return;
  copied.add(name);

  let sourceDir = resolvePackageDir(name, lookupPaths);
  if (!sourceDir) {
    sourceDir = findInPnpmStore(name);
  }
  if (!sourceDir) {
    console.warn(`Skipping ${name}: could not resolve package`);
    return;
  }

  const targetDir = join(targetModulesDir, name);
  if (existsSync(targetDir)) {
    if (packageDirLooksComplete(targetDir)) return;
    console.warn(`Replacing incomplete copy of ${name} at ${targetDir}`);
    rmSync(targetDir, { recursive: true, force: true });
  }

  console.log(`Copying ${name}: ${sourceDir} -> ${targetDir}`);
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });

  // Recursively copy production dependencies from this package's directory
  try {
    const pkg = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'));
    const deps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    };
    for (const dep of Object.keys(deps)) {
      copyPackage(dep, [sourceDir]);
    }
  } catch (e) {
    console.warn(`Failed to read dependencies for ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

mkdirSync(targetModulesDir, { recursive: true });

function esbuildPlatformPackageName() {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `@esbuild/${platform}-${arch}`;
}

// Start resolution from the web-api package and the workspace root so transitive
// dependencies of @huggingface/transformers are reachable in all environments.
const lookupDirs = [webApiDir, workspaceRoot];

const hfDir = resolvePackageDir('@huggingface/transformers', lookupDirs);
if (hfDir) {
  lookupDirs.unshift(hfDir);
}

for (const pkg of externalPackages) {
  copyPackage(pkg, lookupDirs);
}

const esbuildPlatform = esbuildPlatformPackageName();
copyPackage(esbuildPlatform, lookupDirs);

console.log('Runtime dependencies copied to dist/node_modules');
