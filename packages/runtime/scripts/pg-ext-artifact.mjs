#!/usr/bin/env node
/**
 * Helpers for CI pg-extension artifacts: stage built @embedded-postgres trees for
 * upload and install downloaded artifacts into workspace node_modules.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgVectorControlPath } from '../../desktop/scripts/embedded-postgres-pack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = join(__dirname, '..');
const workspaceRoot = resolve(runtimeRoot, '..', '..');

const SUFFIX_TO_PACKAGE = {
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'windows-x64': '@embedded-postgres/windows-x64',
};

function packageFolder(pkgName) {
  return pkgName.split('/')[1];
}

function embeddedCandidates(pkgName) {
  const folder = packageFolder(pkgName);
  return [
    join(workspaceRoot, 'node_modules', '@embedded-postgres', folder),
    join(runtimeRoot, 'node_modules', '@embedded-postgres', folder),
    join(workspaceRoot, 'packages', 'desktop', 'node_modules', '@embedded-postgres', folder),
  ];
}

function resolveBuiltPackageRoot(pkgName, packPlatform = process.platform === 'win32' ? 'win32' : process.platform) {
  for (const candidate of embeddedCandidates(pkgName)) {
    const control = pgVectorControlPath(join(candidate, 'native'), packPlatform);
    if (existsSync(control)) return candidate;
  }
  return null;
}

function stageCommand(suffix) {
  const pkgName = SUFFIX_TO_PACKAGE[suffix];
  if (!pkgName) {
    throw new Error(`Unknown pg extension suffix: ${suffix}`);
  }

  const packPlatform = suffix.startsWith('windows') ? 'win32' : suffix.startsWith('darwin') ? 'darwin' : 'linux';
  const builtRoot = resolveBuiltPackageRoot(pkgName, packPlatform);
  if (!builtRoot) {
    throw new Error(
      `pgvector is not installed for ${pkgName}. `
      + 'Run pnpm --filter @agentx/runtime run setup:extensions first.',
    );
  }

  const stageRoot = join(runtimeRoot, '.pg-ext-artifact', packageFolder(pkgName));
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(dirname(stageRoot), { recursive: true });
  cpSync(builtRoot, stageRoot, { recursive: true });
  console.log(`Staged ${pkgName} from ${builtRoot} -> ${stageRoot}`);
}

function installCommand(suffix, sourceDir) {
  const pkgName = SUFFIX_TO_PACKAGE[suffix];
  if (!pkgName) {
    throw new Error(`Unknown pg extension suffix: ${suffix}`);
  }

  const folder = packageFolder(pkgName);
  const sourceCandidates = [
    join(sourceDir, folder),
    sourceDir,
  ];
  const sourceRoot = sourceCandidates.find((candidate) => existsSync(join(candidate, 'package.json')));
  if (!sourceRoot) {
    throw new Error(`Downloaded pg extension artifact is missing ${folder}/package.json under ${sourceDir}`);
  }

  for (const destRoot of embeddedCandidates(pkgName)) {
    rmSync(destRoot, { recursive: true, force: true });
    mkdirSync(dirname(destRoot), { recursive: true });
    cpSync(sourceRoot, destRoot, { recursive: true });
    console.log(`Installed ${pkgName} -> ${destRoot}`);
  }
}

function usage() {
  console.error('Usage:');
  console.error('  node pg-ext-artifact.mjs stage <suffix>');
  console.error('  node pg-ext-artifact.mjs install <suffix> <artifact-dir>');
  process.exit(1);
}

const [command, suffix, sourceDir] = process.argv.slice(2);
if (command === 'stage') {
  stageCommand(suffix);
} else if (command === 'install') {
  if (!sourceDir) usage();
  installCommand(suffix, resolve(sourceDir));
} else {
  usage();
}
