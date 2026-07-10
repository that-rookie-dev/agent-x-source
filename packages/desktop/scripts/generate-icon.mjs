import { writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, platform } from 'os';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const LOGO_PNG = join(ROOT, 'assets', 'logo.png');
const BUILD = join(import.meta.dirname, '..', 'build');
const ICON_PNG = join(BUILD, 'icon.png');
const TRAY_PNG = join(BUILD, 'tray.png');
const ICON_ICNS = join(BUILD, 'icon.icns');
const IS_MAC = platform() === 'darwin';

if (!existsSync(LOGO_PNG)) {
  console.error('Source logo.png not found at', LOGO_PNG);
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'agentx-icons-'));
const sizes = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

function hasPillow(py) {
  try { execSync(`${py} -c "from PIL import Image, ImageDraw"`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function getPython() {
  for (const py of ['python3', 'python']) {
    try { execSync(`${py} -c "import sys"`, { stdio: 'pipe' }); return py; }
    catch {}
  }
  return null;
}

try {
  const py = getPython();
  if (!py || !hasPillow(py)) {
    console.log('Python/Pillow not available, copying logo as-is for both icons');
    copyFileSync(LOGO_PNG, TRAY_PNG);
    copyFileSync(LOGO_PNG, ICON_PNG);
  } else {
    const script = `
import sys
from PIL import Image, ImageDraw

logo_path = sys.argv[1]
out_dir = sys.argv[2]
SIZE = 1024

logo = Image.open(logo_path).convert('RGBA')

# ============================================================
# APP ICON: dark squircle background + white logo
# ============================================================
icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)

# Full-bleed dark square (macOS applies squircle mask automatically)
draw.rectangle([0, 0, SIZE, SIZE], fill=(28, 28, 30, 255))

# Place logo centered, ~55% of icon size
logo_target = int(SIZE * 0.55)
logo_resized = logo.resize((logo_target, logo_target), Image.LANCZOS)
offset = (SIZE - logo_target) // 2
icon.paste(logo_resized, (offset, offset), logo_resized)

icon.save(f'{out_dir}/icon_1024.png')

# Scale to all sizes for iconset
for name, sz in [('icon_16x16.png',16),('icon_16x16@2x.png',32),('icon_32x32.png',32),('icon_32x32@2x.png',64),('icon_128x128.png',128),('icon_128x128@2x.png',256),('icon_256x256.png',256),('icon_256x256@2x.png',512),('icon_512x512.png',512),('icon_512x512@2x.png',1024)]:
    Image.open(f'{out_dir}/icon_1024.png').resize((sz, sz), Image.LANCZOS).save(f'{out_dir}/{name}')

# ============================================================
# TRAY ICON: logo.png as-is (white on transparent)
# Resized to a reasonable source size
# ============================================================
tray = logo.copy()
if tray.mode != 'RGBA':
    tray = tray.convert('RGBA')
tray = tray.resize((64, 64), Image.LANCZOS)
tray.save(f'{out_dir}/tray.png')
`;

    const scriptPath = join(tmpDir, 'gen.py');
    writeFileSync(scriptPath, script);
    execSync(`${py} "${scriptPath}" "${LOGO_PNG}" "${tmpDir}"`, { stdio: 'pipe' });

    copyFileSync(join(tmpDir, 'icon_1024.png'), ICON_PNG);
    copyFileSync(join(tmpDir, 'tray.png'), TRAY_PNG);

    if (IS_MAC) {
      const iconset = join(tmpDir, 'AppIcon.iconset');
      mkdirSync(iconset, { recursive: true });
      for (const [name] of sizes) {
        copyFileSync(join(tmpDir, name), join(iconset, name));
      }
      try {
        execSync(`iconutil -c icns "${iconset}" -o "${ICON_ICNS}"`, { stdio: 'pipe' });
        console.log('Icons generated (macOS .icns included)');
      } catch (e) {
        if (existsSync(ICON_ICNS)) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`iconutil failed; keeping existing ${ICON_ICNS}: ${msg}`);
        } else {
          throw e;
        }
      }
    } else {
      console.log('Icons generated');
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
