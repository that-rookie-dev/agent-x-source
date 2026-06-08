import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const buildDir = join(root, 'build');

const iconPath = join(buildDir, 'icon.png');
const trayPaths = [join(buildDir, 'Tray.png'), join(buildDir, 'TrayWin.png')];

const assetsDir = join(root, '..', '..', '..', 'release', 'assets');

// App icon: use agent_x_logo.png with black background composited (prefer assets, build dir is output)
const iconSources = [
  join(assetsDir, 'agent_x_logo_bg.png'),
  join(assetsDir, 'agent_x_logo.png'),
];

// Tray icons: use agent_x_tray_logo.png (transparent for menu bar) — prefer assets
const traySources = [
  join(assetsDir, 'agent_x_tray_logo.png'),
  join(assetsDir, 'agent_x_logo.png'),
];

const iconSrc = iconSources.find(existsSync);
const traySrc = traySources.find(existsSync);

if (iconSrc) {
  if (iconSrc !== iconPath) {
    copyFileSync(iconSrc, iconPath);
  }
  console.log(`App icon: ${iconPath} (from ${iconSrc})`);
} else {
  console.log('No app icon found, generating fallback...');
  generateFallbackIcon();
}

// Tray icons use transparent version
if (traySrc) {
  for (const dest of trayPaths) {
    copyFileSync(traySrc, dest);
    console.log(`Tray icon: ${dest} (from ${traySrc})`);
  }
} else if (!existsSync(trayPaths[0])) {
  // Fallback: use the app icon if no tray-specific source
  if (iconSrc) {
    for (const dest of trayPaths) {
      copyFileSync(iconSrc, dest);
      console.log(`Tray icon (fallback): ${dest}`);
    }
  }
}

// On macOS, generate proper .icns with black background
if (process.platform === 'darwin') {
  const { execSync } = await import('node:child_process');
  const icnsScript = join(__dirname, 'generate-icns.py');
  if (existsSync(icnsScript)) {
    try {
      execSync(`python3 ${icnsScript}`, { stdio: 'inherit' });
    } catch (e) {
      console.log('generate-icns.py failed, electron-builder will use PNG:', e.message);
    }
  }
}

function generateFallbackIcon() {
  const SIZE = 512;
  const raw = Buffer.alloc(SIZE * SIZE * 4, 0);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = SIZE / 2, cy = SIZE / 2;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = SIZE / 2 - 8;

      if (dist > radius) continue;

      let r = 30, g = 30, b = 30;

      const angle = Math.atan2(dy, dx);
      const arm = (Math.abs(dx * 0.7 + dy * 0.7) < 20) || (Math.abs(dx * 0.7 - dy * 0.7) < 20);

      if (arm) {
        const segment = Math.floor((dx + dy) / 12) % 2;
        if (segment === 0) { r = 86; g = 156; b = 214; }
        else { r = 86; g = 156; b = 214; }
        const fade = Math.max(0, Math.min(1, (radius - dist) / 30));
        r = Math.floor(r * fade + 30 * (1 - fade));
        g = Math.floor(g * fade + 30 * (1 - fade));
        b = Math.floor(b * fade + 30 * (1 - fade));
      } else if (dist < radius * 0.3) {
        r = 106; g = 153; b = 85;
        const fade = Math.max(0, (radius * 0.3 - dist) / (radius * 0.3));
        r = Math.floor(r * fade + 30 * (1 - fade));
        g = Math.floor(g * fade + 30 * (1 - fade));
        b = Math.floor(b * fade + 30 * (1 - fade));
      }

      raw[(y * SIZE + x) * 4 + 0] = r;
      raw[(y * SIZE + x) * 4 + 1] = g;
      raw[(y * SIZE + x) * 4 + 2] = b;
      raw[(y * SIZE + x) * 4 + 3] = 255;
    }
  }

  const W = 4;
  const rowSize = 1 + SIZE * W;
  const rawData = Buffer.alloc(rowSize * SIZE);

  for (let y = 0; y < SIZE; y++) {
    rawData[y * rowSize] = 0;
    for (let x = 0; x < SIZE; x++) {
      const srcOff = (y * SIZE + x) * 4;
      const dstOff = y * rowSize + 1 + x * W;
      rawData[dstOff + 0] = raw[srcOff + 2];
      rawData[dstOff + 1] = raw[srcOff + 1];
      rawData[dstOff + 2] = raw[srcOff + 0];
      rawData[dstOff + 3] = raw[srcOff + 3];
    }
  }

  const compressed = deflateSync(rawData);

  function crc32(buf) {
    let crc = 0xffffffff;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeB, data]);
    const crcV = Buffer.alloc(4);
    crcV.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeB, data, crcV]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  writeFileSync(iconPath, png);
  console.log(`Fallback icon generated: ${iconPath} (${png.length} bytes)`);

  // Generate simple tray icons
  for (const [size, name] of [[22, 'Tray.png'], [16, 'TrayWin.png']]) {
    const trayRaw = Buffer.alloc(size * size * 4, 0);
    const cx = size / 2, cy = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = size / 2 - 1;
        if (dist > radius) continue;
        trayRaw[(y * size + x) * 4 + 0] = 86;
        trayRaw[(y * size + x) * 4 + 1] = 156;
        trayRaw[(y * size + x) * 4 + 2] = 214;
        trayRaw[(y * size + x) * 4 + 3] = 255;
      }
    }

    const trayRowSize = 1 + size * 4;
    const trayRawData = Buffer.alloc(trayRowSize * size);
    for (let y = 0; y < size; y++) {
      trayRawData[y * trayRowSize] = 0;
      for (let x = 0; x < size; x++) {
        const srcOff = (y * size + x) * 4;
        const dstOff = y * trayRowSize + 1 + x * 4;
        trayRawData[dstOff + 0] = trayRaw[srcOff + 2];
        trayRawData[dstOff + 1] = trayRaw[srcOff + 1];
        trayRawData[dstOff + 2] = trayRaw[srcOff + 0];
        trayRawData[dstOff + 3] = trayRaw[srcOff + 3];
      }
    }

    const trayCompressed = deflateSync(trayRawData);
    const ihdr2 = Buffer.alloc(13);
    ihdr2.writeUInt32BE(size, 0);
    ihdr2.writeUInt32BE(size, 4);
    ihdr2[8] = 8; ihdr2[9] = 6; ihdr2[10] = 0; ihdr2[11] = 0; ihdr2[12] = 0;

    const trayPng = Buffer.concat([
      signature,
      chunk('IHDR', ihdr2),
      chunk('IDAT', trayCompressed),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    writeFileSync(join(buildDir, name), trayPng);
    console.log(`Fallback tray icon generated: ${join(buildDir, name)}`);
  }
}
