/**
 * Stage bundled voice assets into packages/voice-sidecar/bundled/
 * Used by both desktop and server packaging.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const voiceSidecarDir = join(scriptDir, '..');
const manifestPath = join(voiceSidecarDir, 'voice-models.manifest.json');
const bundleRoot = join(voiceSidecarDir, 'bundled');
const tmpRoot = join(bundleRoot, '.tmp');

function log(message) {
  console.log(`setup-bundled-voice-assets: ${message}`);
}

function computeDirectorySha256(directory) {
  const hash = createHash('sha256');
  for (const file of walkFiles(directory).sort()) {
    hash.update(file.slice(directory.length + 1));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

async function downloadSileroVad(targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  const url = 'https://github.com/snakers4/silero-vad/archive/refs/heads/master.zip';
  const zipPath = join(tmpRoot, 'silero-vad.zip');
  mkdirSync(tmpRoot, { recursive: true });

  log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(zipPath));

  const extractDir = join(tmpRoot, 'silero-vad-extract');
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: 'inherit' });

  const extracted = join(extractDir, 'silero-vad-master');
  execSync(`cp -R "${extracted}/." "${targetDir}"`, { stdio: 'inherit' });
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bundled = manifest.assets.filter((asset) => asset.tier === 'bundled');
  if (bundled.length === 0) {
    log('No bundled voice assets declared in manifest');
    return;
  }

  mkdirSync(bundleRoot, { recursive: true });
  const bundleInfo = { version: manifest.version, assets: {} };

  for (const asset of bundled) {
    const targetDir = join(bundleRoot, asset.id);
    const needsRefresh = !existsSync(targetDir) || statSync(targetDir).size === 0;
    if (needsRefresh) {
      if (asset.id === 'silero-vad') {
        await downloadSileroVad(targetDir);
      } else {
        throw new Error(`No bundler handler for ${asset.id}`);
      }
    } else {
      log(`Reusing existing bundled asset ${asset.id}`);
    }

    const sha256 = computeDirectorySha256(targetDir);
    bundleInfo.assets[asset.id] = { sha256, target: asset.target, kind: asset.kind };
    log(`${asset.id} sha256=${sha256.slice(0, 12)}…`);
  }

  writeFileSync(join(bundleRoot, 'bundle-info.json'), JSON.stringify(bundleInfo, null, 2));
  rmSync(tmpRoot, { recursive: true, force: true });
  log(`Bundled voice assets ready at ${bundleRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
