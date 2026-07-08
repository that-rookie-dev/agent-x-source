const { execSync } = require('child_process');
const { existsSync, writeFileSync, readdirSync, cpSync, mkdirSync, rmSync } = require('fs');
const { join, dirname } = require('path');

function storeEntryPrefix(pkgName) {
  return pkgName.startsWith('@') ? `${pkgName.replace('/', '+')}@` : `${pkgName}@`;
}

function findInPnpmStore(pnpmStore, pkgName) {
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

function resolveArchName(arch) {
  const s = String(arch).toLowerCase();
  if (s.includes('arm') || arch === 3) return 'arm64';
  return 'x64';
}

function embeddedPackageFor(platform, archName) {
  switch (platform) {
    case 'darwin':
      return archName === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64';
    case 'linux':
      return archName === 'arm64' ? '@embedded-postgres/linux-arm64' : '@embedded-postgres/linux-x64';
    case 'win32':
      return '@embedded-postgres/windows-x64';
    default:
      return '';
  }
}

function getAppResourcesDir(context) {
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (context.electronPlatformName === 'darwin') {
    return join(appPath, 'Contents', 'Resources');
  }
  return join(context.appOutDir, 'resources');
}

function bundleScopedPackage(destRoot, pnpmStore, pkgName, { requireNativeBin = false, platform = 'darwin' } = {}) {
  const destDir = join(destRoot, ...pkgName.split('/'));
  const binName = platform === 'win32' ? 'postgres.exe' : 'postgres';
  const ready = requireNativeBin
    ? existsSync(join(destDir, 'native', 'bin', binName))
    : existsSync(join(destDir, 'package.json'));
  if (ready) {
    console.log(`afterPack: ${pkgName} already present, skipping`);
    return;
  }

  const found = findInPnpmStore(pnpmStore, pkgName);
  if (!found) {
    throw new Error(`afterPack: could not find ${pkgName} in pnpm store — run pnpm install from the repo root`);
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(found, destDir, { recursive: true, force: true });
  console.log(`afterPack: bundled ${pkgName} into app.asar.unpacked`);
}

function bundleEmbeddedPostgres(context, pnpmStore) {
  const archName = resolveArchName(context.arch);
  const platform = context.electronPlatformName;
  const pkg = embeddedPackageFor(platform, archName);
  if (!pkg) {
    throw new Error(`afterPack: no embedded-postgres package for ${platform}/${archName}`);
  }

  const resourcesDir = getAppResourcesDir(context);
  if (!existsSync(resourcesDir)) {
    console.warn('afterPack: app resources dir not found, skipping embedded-postgres bundle');
    return;
  }

  const destRoot = join(resourcesDir, 'app.asar.unpacked', 'node_modules');
  bundleScopedPackage(destRoot, pnpmStore, pkg, { requireNativeBin: true, platform });
  bundleScopedPackage(destRoot, pnpmStore, 'embedded-postgres', { platform });
}

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
  const pnpmStore = resolvePnpmStore(context);
  if (pnpmStore) {
    bundleEmbeddedPostgres(context, pnpmStore);
  } else {
    console.warn('afterPack: pnpm store not found, skipping embedded-postgres bundle');
  }

  const webApiDir = getWebApiDir(context);
  if (!webApiDir || !existsSync(webApiDir)) {
    console.log('afterPack: web-api resources not found, skipping web-api bundling');
  } else {
    // Ensure web-api resources have a package.json with "type": "module"
    writeFileSync(join(webApiDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf-8');
    console.log('afterPack: created web-api/package.json (type: module)');

    if (pnpmStore) {
      bundleMissingNativeDeps(webApiDir, pnpmStore);
      bundleOnnxRuntimeDeps(webApiDir, pnpmStore);
      bundlePdfjsDist(webApiDir, pnpmStore);
    }
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
