import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  // Fully re-sign the bundle ad-hoc with proper resource sealing.
  // Passing --preserve-metadata=none forces codesign to re-seal all resources,
  // fixing the "code has no resources but signature indicates they must be present"
  // warning that macOS interprets as a broken bundle when quarantined.
  try {
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    );
    console.log('afterPack: clean ad-hoc signature applied');
  } catch (err) {
    console.error('afterPack: codesign failed —', err.message);
  }
}
