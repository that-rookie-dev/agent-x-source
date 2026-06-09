import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export default async function afterPack(context) {
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
}
