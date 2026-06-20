const { execSync } = require('child_process');
const { existsSync, writeFileSync } = require('fs');
const { join } = require('path');

module.exports = async function afterPack(context) {
  // Ensure web-api resources have a package.json with "type": "module" so that
  // Electron's Node.js runtime can load the ESM web-api bundle correctly.
  // This is needed on all platforms, not just macOS.
  let webApiDir;
  if (context.electronPlatformName === 'darwin') {
    const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    if (!existsSync(appPath)) return;
    webApiDir = join(appPath, 'Contents', 'Resources', 'web-api');
  } else {
    webApiDir = join(context.appOutDir, 'resources', 'web-api');
  }

  if (existsSync(webApiDir)) {
    writeFileSync(join(webApiDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf-8');
    console.log('afterPack: created web-api/package.json (type: module)');
  }

  // macOS-only: ad-hoc codesigning
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  // If developer credentials are available (CSC_LINK is set), electron-builder
  // handles signing automatically with the Developer ID certificate.
  // Only fall back to ad-hoc signing when no credentials are present (CI/local dev).
  if (process.env.CSC_LINK || process.env.APPLE_ID) {
    console.log('afterPack: Developer signing credentials detected — skipping ad-hoc override');
    return;
  }

  // Ad-hoc signing for unsigned builds (CI without credentials, local dev)
  try {
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    );
    console.log('afterPack: ad-hoc signature applied (unsigned build)');
  } catch (err) {
    console.error('afterPack: ad-hoc codesign failed —', err.message);
  }
};
