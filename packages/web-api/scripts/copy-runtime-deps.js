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
import { execSync } from 'node:child_process';
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
  'trafilatura',
  'httpcloak',
  'playwright',
  '@homebridge/node-pty-prebuilt-multiarch',
];

/** Must be present next to the bundled web-api entry or the packaged app fails to start. */
const requiredExternalPackages = [
  '@homebridge/node-pty-prebuilt-multiarch',
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
    if (!packageDirLooksComplete(targetDir)) {
      console.warn(`Replacing incomplete copy of ${name} at ${targetDir}`);
      rmSync(targetDir, { recursive: true, force: true });
    }
  }
  if (!existsSync(targetDir)) {
    console.log(`Copying ${name}: ${sourceDir} -> ${targetDir}`);
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
  }

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

for (const pkg of requiredExternalPackages) {
  const dest = join(targetModulesDir, ...pkg.split('/'), 'package.json');
  if (!existsSync(dest)) {
    throw new Error(`copy-runtime-deps: required package ${pkg} was not copied into dist/node_modules`);
  }
}

const esbuildPlatform = esbuildPlatformPackageName();
copyPackage(esbuildPlatform, lookupDirs);

// The persistent Playwright child is built as a separate ESM entry in the
// engine package. It must live next to the web-api bundle so the manager
// can fork it using a relative URL.
const engineChild = join(workspaceRoot, 'packages', 'engine', 'dist', 'tools', 'builtin', 'playwright-manager-child.js');
const childDest = join(distDir, 'tools', 'builtin', 'playwright-manager-child.js');
if (existsSync(engineChild)) {
  mkdirSync(dirname(childDest), { recursive: true });
  cpSync(engineChild, childDest);
  console.log('Copied playwright-manager-child.js to dist/tools/builtin');
} else {
  console.warn('playwright-manager-child.js not found in engine dist');
}

// Playwright's browser binaries are not part of the npm package. Bundle them
// next to the shipped package so the packaged app works without a separate
// `npx playwright install` step on the user's machine.
// Cache outside dist/ so tsup `clean: true` does not force a ~300MB re-download every build.
const playwrightBrowserCache = join(webApiDir, '.cache', 'playwright-browsers');
const bundledBrowsers = join(targetModulesDir, 'playwright-core', '.local-browsers');
const playwrightCli = join(targetModulesDir, 'playwright', 'cli.js');

function copyPlaywrightBrowsersFromCache() {
  if (!existsSync(playwrightBrowserCache)) return false;
  mkdirSync(dirname(bundledBrowsers), { recursive: true });
  cpSync(playwrightBrowserCache, bundledBrowsers, { recursive: true, dereference: true });
  console.log('Restored Playwright browsers from .cache/playwright-browsers');
  return true;
}

function savePlaywrightBrowsersToCache() {
  if (!existsSync(bundledBrowsers)) return;
  mkdirSync(playwrightBrowserCache, { recursive: true });
  rmSync(playwrightBrowserCache, { recursive: true, force: true });
  cpSync(bundledBrowsers, playwrightBrowserCache, { recursive: true, dereference: true });
  console.log('Cached Playwright browsers to .cache/playwright-browsers');
}

if (existsSync(playwrightCli) && !existsSync(bundledBrowsers)) {
  if (!copyPlaywrightBrowsersFromCache()) {
    try {
      console.log('Installing Playwright Chromium browsers into package (this may take a minute)...');
      execSync(`node "${playwrightCli}" install chromium`, {
        cwd: targetModulesDir,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
        stdio: 'inherit',
        timeout: 600000,
      });
      console.log('Playwright Chromium browsers installed');
      savePlaywrightBrowsersToCache();
    } catch (e) {
      console.warn('Failed to install Playwright browsers; packaged app will need `npx playwright install chromium` at runtime:', e instanceof Error ? e.message : e);
    }
  }
}

console.log('Runtime dependencies copied to dist/node_modules');
