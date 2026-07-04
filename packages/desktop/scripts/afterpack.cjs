const { execSync } = require('child_process');
const { existsSync, writeFileSync, readdirSync, cpSync, mkdirSync, rmSync } = require('fs');
const { join, dirname } = require('path');

function getWebApiDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    if (!existsSync(appPath)) return null;
    return join(appPath, 'Contents', 'Resources', 'web-api');
  }
  return join(context.appOutDir, 'resources', 'web-api');
}

function resolvePnpmStore(context) {
  // walk up from appOutDir to find workspace root (where node_modules/.pnpm lives)
  let dir = context.appOutDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '.pnpm');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function packageDirLooksComplete(dir) {
  return existsSync(join(dir, 'package.json'));
}

function bundlePackageFromPnpmStore(webApiDir, pnpmStore, dep) {
  const destDir = join(webApiDir, 'node_modules', dep);
  if (existsSync(destDir) && packageDirLooksComplete(destDir)) {
    console.log(`afterPack: ${dep} already present, skipping`);
    return;
  }
  if (existsSync(destDir)) {
    console.warn(`afterPack: replacing incomplete ${dep} at ${destDir}`);
    rmSync(destDir, { recursive: true, force: true });
  }

  // Find the matching directory in pnpm store
  let found = null;
  for (const entry of readdirSync(pnpmStore)) {
    if (entry.startsWith(dep + '@')) {
      const src = join(pnpmStore, entry, 'node_modules', dep);
      if (existsSync(src)) {
        found = src;
        break;
      }
    }
  }

  if (!found) {
    console.warn(`afterPack: could not find ${dep} in pnpm store`);
    return;
  }

  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(found, destDir, { recursive: true, force: true });
  console.log(`afterPack: bundled ${dep} from pnpm store`);
}

function bundleMissingNativeDeps(webApiDir, pnpmStore) {
  const needed = ['bindings', 'file-uri-to-path'];
  for (const dep of needed) {
    bundlePackageFromPnpmStore(webApiDir, pnpmStore, dep);
  }
}

function bundleOnnxRuntimeDeps(webApiDir, pnpmStore) {
  const needed = ['onnxruntime-node', 'onnxruntime-web', 'onnxruntime-common'];
  for (const dep of needed) {
    bundlePackageFromPnpmStore(webApiDir, pnpmStore, dep);
  }
}

function bundlePdfjsDist(webApiDir, pnpmStore) {
  bundlePackageFromPnpmStore(webApiDir, pnpmStore, 'pdfjs-dist');
}

module.exports = async function afterPack(context) {
  const webApiDir = getWebApiDir(context);
  if (!webApiDir || !existsSync(webApiDir)) {
    console.log('afterPack: web-api resources not found, skipping');
    return;
  }

  // Ensure web-api resources have a package.json with "type": "module"
  writeFileSync(join(webApiDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf-8');
  console.log('afterPack: created web-api/package.json (type: module)');

  // Bundle native dependencies that may be missing from the pnpm store
  const pnpmStore = resolvePnpmStore(context);
  if (pnpmStore) {
    bundleMissingNativeDeps(webApiDir, pnpmStore);
    bundleOnnxRuntimeDeps(webApiDir, pnpmStore);
    bundlePdfjsDist(webApiDir, pnpmStore);
  } else {
    console.warn('afterPack: pnpm store not found, skipping native dep bundling');
  }

  // macOS-only: ad-hoc codesigning
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  if (process.env.CSC_LINK || process.env.APPLE_ID) {
    console.log('afterPack: Developer signing credentials detected — skipping ad-hoc override');
    return;
  }

  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    console.log('afterPack: ad-hoc signature applied (unsigned build)');
  } catch (err) {
    console.error('afterPack: ad-hoc codesign failed —', err.message);
  }
};
