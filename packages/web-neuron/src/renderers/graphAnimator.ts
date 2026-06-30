export type PulseKind = 'blink' | 'birth' | 'fire' | 'decay';

interface TimedEffect {
  kind: PulseKind | 'edge-fire' | 'edge-particle';
  start: number;
  duration: number;
}

/** Tracks transient visual effects (pulses, edge fires, travelling particles). */
export class GraphAnimator {
  private nodeEffects = new Map<string, TimedEffect>();
  private edgeEffects = new Map<string, TimedEffect>();
  private listeners = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private addNodeEffect(id: string, kind: PulseKind, duration: number): void {
    this.nodeEffects.set(id, { kind, start: performance.now(), duration });
    this.notify();
  }

  pulseNode(id: string, kind: PulseKind = 'blink', durationMs = 2200): void {
    this.addNodeEffect(id, kind, durationMs);
  }

  pulseCluster(nodeIds: string[], durationMs = 2200): void {
    const now = performance.now();
    for (const id of nodeIds) {
      this.nodeEffects.set(id, { kind: 'blink', start: now, duration: durationMs });
    }
    this.notify();
  }

  animateBirth(id: string, durationMs = 900): void {
    this.addNodeEffect(id, 'birth', durationMs);
  }

  animateDecay(id: string, durationMs = 700): void {
    this.addNodeEffect(id, 'decay', durationMs);
  }

  fireEdge(edgeId: string, durationMs = 650): void {
    const now = performance.now();
    this.edgeEffects.set(edgeId, { kind: 'edge-fire', start: now, duration: durationMs });
    this.edgeEffects.set(`${edgeId}:particle`, { kind: 'edge-particle', start: now, duration: durationMs });
    this.notify();
  }

  fireFromNode(nodeId: string, edgeIds: string[], staggerMs = 55): void {
    edgeIds.forEach((edgeId, i) => {
      setTimeout(() => this.fireEdge(edgeId), i * staggerMs);
    });
    this.pulseNode(nodeId, 'fire', 500);
  }

  prune(now = performance.now()): boolean {
    let changed = false;
    for (const [id, fx] of this.nodeEffects) {
      if (now - fx.start > fx.duration) {
        this.nodeEffects.delete(id);
        changed = true;
      }
    }
    for (const [id, fx] of this.edgeEffects) {
      if (now - fx.start > fx.duration) {
        this.edgeEffects.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify();
    return changed;
  }

  /** Returns multipliers for node rendering [0..1] progress through effect. */
  getNodeEffect(id: string, now = performance.now()): {
    sizeMul: number;
    whiteMix: number;
    alphaMul: number;
    active: boolean;
  } {
    const fx = this.nodeEffects.get(id);
    if (!fx) return { sizeMul: 1, whiteMix: 0, alphaMul: 1, active: false };
    const t = Math.min(1, (now - fx.start) / fx.duration);

    switch (fx.kind) {
      case 'birth': {
        // Elastic overshoot settle
        const ease = 1 - Math.pow(1 - t, 3);
        const overshoot = 1 + 0.35 * Math.sin(t * Math.PI * 2.5) * (1 - t);
        return { sizeMul: ease * overshoot, whiteMix: (1 - t) * 0.6, alphaMul: 0.4 + ease * 0.6, active: true };
      }
      case 'decay':
        return { sizeMul: 1 - t * 0.85, whiteMix: t * 0.3, alphaMul: 1 - t, active: true };
      case 'fire':
        return {
          sizeMul: 1 + 0.6 * Math.sin(t * Math.PI),
          whiteMix: Math.sin(t * Math.PI) * 0.85,
          alphaMul: 1,
          active: true,
        };
      case 'blink':
      default: {
        const blink = 0.5 + 0.5 * Math.sin(t * Math.PI * 6);
        return { sizeMul: 1 + blink * 0.15, whiteMix: blink * 0.45, alphaMul: 0.75 + blink * 0.25, active: true };
      }
    }
  }

  getEdgeEffect(edgeId: string, now = performance.now()): {
    sizeMul: number;
    whiteMix: number;
    particleT: number | null;
    active: boolean;
  } {
    const fire = this.edgeEffects.get(edgeId);
    const particle = this.edgeEffects.get(`${edgeId}:particle`);
    if (!fire && !particle) return { sizeMul: 1, whiteMix: 0, particleT: null, active: false };

    let sizeMul = 1;
    let whiteMix = 0;
    if (fire) {
      const t = Math.min(1, (now - fire.start) / fire.duration);
      const wave = Math.sin(t * Math.PI);
      sizeMul = 1 + wave * 2.5;
      whiteMix = wave * 0.9;
    }

    let particleT: number | null = null;
    if (particle) {
      const t = Math.min(1, (now - particle.start) / particle.duration);
      particleT = t;
    }

    return { sizeMul, whiteMix, particleT, active: true };
  }

  getActiveEdgeParticles(now = performance.now()): Array<{ edgeId: string; t: number }> {
    const out: Array<{ edgeId: string; t: number }> = [];
    for (const [key, fx] of this.edgeEffects) {
      if (fx.kind !== 'edge-particle') continue;
      const edgeId = key.replace(/:particle$/, '');
      const t = Math.min(1, (now - fx.start) / fx.duration);
      if (t < 1) out.push({ edgeId, t });
    }
    return out;
  }

  hasActiveEffects(now = performance.now()): boolean {
    for (const fx of this.nodeEffects.values()) {
      if (now - fx.start < fx.duration) return true;
    }
    for (const fx of this.edgeEffects.values()) {
      if (now - fx.start < fx.duration) return true;
    }
    return false;
  }
}

/** Blend hex colour toward white. */
export function mixTowardWhite(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6 || amount <= 0) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const m = Math.min(1, amount);
  const rr = Math.round(r + (255 - r) * m);
  const gg = Math.round(g + (255 - g) * m);
  const bb = Math.round(b + (255 - b) * m);
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
