import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(import.meta.dirname, '..');
  const extensionTestsPath = path.resolve(import.meta.dirname, './suite/index.js');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    });
  } catch {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
