import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const BUILD = join(import.meta.dirname, '..', 'build');
const ICON_PNG = join(BUILD, 'icon.png');
const TRAY_PNG = join(BUILD, 'tray.png');
const ICON_ICNS = join(BUILD, 'icon.icns');

if (!existsSync(ICON_PNG)) {
  console.error('Source icon.png not found at', ICON_PNG);
  process.exit(1);
}

const canvasSize = 1024;
const safeZone = 824;
const margin = (canvasSize - safeZone) / 2;

const iconsetDir = mkdtempSync(join(tmpdir(), 'agentx-iconset-'));
const iconset = join(iconsetDir, 'AppIcon.iconset');
mkdirSync(iconset, { recursive: true });

const sizes = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

const pyScript = join(iconset, 'generate.py');
const pyCode = `
import subprocess, sys
from PIL import Image

# Parse args: source_png padded_png safe_zone margin tray_png
src, padded, sz, mg, tray = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] if len(sys.argv) > 5 else None

sz_int = int(sz)
mg_int = int(mg)

img = Image.open(src).convert('RGBA')
img_resized = img.resize((sz_int, sz_int), Image.LANCZOS)

canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
canvas.paste(img_resized, (mg_int, mg_int), img_resized)
canvas.save(padded)

if tray and tray != 'None':
    if Image.open(tray).mode != 'RGBA':
        t = Image.open(tray).convert('RGBA')
    else:
        t = Image.open(tray)
    t = t.resize((32, 32), Image.LANCZOS)
    t.save(tray)
`

writeFileSync(pyScript, pyCode);

try {
  execSync(
    `python3 "${pyScript}" "${ICON_PNG}" "${join(iconset, 'padded.png')}" ${safeZone} ${margin}`,
    { stdio: 'pipe' }
  );

  for (const [name, size] of sizes) {
    execSync(
      `sips -z ${size} ${size} "${join(iconset, 'padded.png')}" --out "${join(iconset, name)}"`,
      { stdio: 'pipe' }
    );
  }

  execSync(`iconutil -c icns "${iconset}" -o "${ICON_ICNS}"`, { stdio: 'pipe' });
  execSync(`cp "${join(iconset, 'padded.png')}" "${ICON_PNG}"`, { stdio: 'pipe' });

  if (existsSync(TRAY_PNG)) {
    execSync(
      `python3 "${pyScript}" "${ICON_PNG}" "${join(iconset, 'padded.png')}" ${safeZone} ${margin} "${TRAY_PNG}"`,
      { stdio: 'pipe' }
    );
  }

  console.log('Icons generated successfully');
} finally {
  rmSync(iconsetDir, { recursive: true, force: true });
}
