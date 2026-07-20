/**
 * Cortex FX — pooled, allocation-free effects that make the brain feel alive.
 *
 * - Ripple: expanding ring flash when a neuron fires or a memory blooms in.
 * - Signal: a spark traveling along a synapse (recall propagation).
 *
 * Both draw from fixed-size pools; when a pool is exhausted new requests are
 * dropped silently (visual garnish must never become a memory leak).
 */
import { Container, Sprite, Texture } from 'pixi.js';

const RIPPLE_POOL = 48;
const SIGNAL_POOL = 96;

interface Ripple {
  sprite: Sprite;
  /** Elapsed 0..1; inactive when >= 1. */
  t: number;
  duration: number;
  startRadius: number;
  endRadius: number;
}

interface Signal {
  sprite: Sprite;
  t: number;
  duration: number;
  x0: number; y0: number; x1: number; y1: number;
}

export class CortexFx {
  readonly layer: Container;
  private ripples: Ripple[] = [];
  private signals: Signal[] = [];

  constructor(haloTexture: Texture, sparkTexture: Texture) {
    this.layer = new Container();
    this.layer.eventMode = 'none';

    for (let i = 0; i < RIPPLE_POOL; i++) {
      const sprite = new Sprite(haloTexture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.blendMode = 'add';
      this.layer.addChild(sprite);
      this.ripples.push({ sprite, t: 1, duration: 1, startRadius: 0, endRadius: 0 });
    }
    for (let i = 0; i < SIGNAL_POOL; i++) {
      const sprite = new Sprite(sparkTexture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.blendMode = 'add';
      this.layer.addChild(sprite);
      this.signals.push({ sprite, t: 1, duration: 1, x0: 0, y0: 0, x1: 0, y1: 0 });
    }
  }

  /** Expanding flash ring at a neuron. */
  ripple(x: number, y: number, tint: number, radius: number, opts: { duration?: number; intensity?: number } = {}): void {
    const r = this.ripples.find((p) => p.t >= 1);
    if (!r) return;
    r.t = 0;
    r.duration = opts.duration ?? 0.9;
    r.startRadius = radius * 1.2;
    r.endRadius = radius * (4 + 2 * (opts.intensity ?? 1));
    r.sprite.position.set(x, y);
    r.sprite.tint = tint;
    r.sprite.visible = true;
  }

  /** Spark traveling from (x0,y0) to (x1,y1). */
  signal(x0: number, y0: number, x1: number, y1: number, tint: number, opts: { duration?: number; size?: number } = {}): void {
    const s = this.signals.find((p) => p.t >= 1);
    if (!s) return;
    s.t = 0;
    s.duration = opts.duration ?? 0.55;
    s.x0 = x0; s.y0 = y0; s.x1 = x1; s.y1 = y1;
    s.sprite.position.set(x0, y0);
    s.sprite.tint = tint;
    s.sprite.width = s.sprite.height = opts.size ?? 5;
    s.sprite.visible = true;
  }

  update(dt: number): void {
    for (const r of this.ripples) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.duration);
      const ease = 1 - (1 - r.t) * (1 - r.t); // ease-out quad
      const radius = r.startRadius + (r.endRadius - r.startRadius) * ease;
      r.sprite.width = r.sprite.height = radius * 2;
      r.sprite.alpha = (1 - r.t) * 0.85;
      if (r.t >= 1) r.sprite.visible = false;
    }
    for (const s of this.signals) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / s.duration);
      const ease = s.t * s.t * (3 - 2 * s.t); // smoothstep
      s.sprite.position.set(s.x0 + (s.x1 - s.x0) * ease, s.y0 + (s.y1 - s.y0) * ease);
      // Bright in the middle of the journey, fading at both ends.
      s.sprite.alpha = Math.sin(s.t * Math.PI) * 0.95;
      if (s.t >= 1) s.sprite.visible = false;
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.ripples = [];
    this.signals = [];
  }
}
