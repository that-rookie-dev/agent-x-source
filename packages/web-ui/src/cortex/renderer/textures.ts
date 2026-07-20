/**
 * Shared GPU textures for the cortex — generated once on a canvas, uploaded
 * once. Every neuron is a tinted sprite of these four textures; there are no
 * per-node textures and no runtime rasterization.
 */
import { Texture } from 'pixi.js';

function radialCanvas(size: number, stops: Array<[number, string]>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export interface CortexTextures {
  /** Hard bright center — the neuron soma. */
  core: Texture;
  /** Soft wide halo — breathing glow (additive). */
  halo: Texture;
  /** Very soft huge blob — community nebulas (additive, low alpha). */
  nebula: Texture;
  /** Tiny soft dot — starfield + edge signal particles. */
  spark: Texture;
}

let cached: CortexTextures | null = null;

export function getCortexTextures(): CortexTextures {
  if (cached) return cached;

  cached = {
    // Soft but readable soma — organic without becoming a white blob.
    core: Texture.from(radialCanvas(64, [
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.95)'],
      [0.7, 'rgba(255,255,255,0.35)'],
      [0.9, 'rgba(255,255,255,0.06)'],
      [1, 'rgba(255,255,255,0)'],
    ])),
    // Soft halo used only for selection / community highlight / firing.
    halo: Texture.from(radialCanvas(128, [
      [0, 'rgba(255,255,255,0.35)'],
      [0.3, 'rgba(255,255,255,0.12)'],
      [0.65, 'rgba(255,255,255,0.03)'],
      [1, 'rgba(255,255,255,0)'],
    ])),
    nebula: Texture.from(radialCanvas(256, [
      [0, 'rgba(255,255,255,0.14)'],
      [0.45, 'rgba(255,255,255,0.06)'],
      [0.8, 'rgba(255,255,255,0.02)'],
      [1, 'rgba(255,255,255,0)'],
    ])),
    spark: Texture.from(radialCanvas(16, [
      [0, 'rgba(255,255,255,1)'],
      [0.5, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ])),
  };
  return cached;
}

export function destroyCortexTextures(): void {
  if (!cached) return;
  for (const t of Object.values(cached)) t.destroy(true);
  cached = null;
}

/**
 * Pre-rendered starfield tile (screen-space background, drawn twice for
 * seamless parallax wrap). Deterministic star placement from a fixed seed.
 */
export function makeStarfieldTexture(size = 512): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rand() * 1.1 + 0.2;
    const a = rand() * 0.35 + 0.05;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${200 + Math.floor(rand() * 55)}, ${210 + Math.floor(rand() * 45)}, 255, ${a})`;
    ctx.fill();
  }
  return Texture.from(canvas);
}
