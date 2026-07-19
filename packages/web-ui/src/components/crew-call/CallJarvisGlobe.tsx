import { useEffect, useRef } from 'react';
import type { ParticlePhase } from '../voice/VoiceParticleField';

/**
 * Jarvis-style neural globe for crew calls (Age of Ultron HUD vibe).
 * Distinct from the dashboard VoiceParticleField orbital drift.
 *
 * 3D sphere of nodes, sparse mesh edges, neuron-fire pulses, spawn/fade particles.
 * Colors follow the same ParticlePhase palette as the rest of voice UI.
 */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Node {
  base: Vec3;
  /** Transient radial offset (spawn / fire swell). */
  swell: number;
  brightness: number;
  pulse: number;
  birth: number;
  life: number;
}

interface Edge {
  a: number;
  b: number;
  strength: number;
}

interface Fire {
  from: number;
  to: number;
  t: number;
  speed: number;
}

const FALLBACK_ACCENT = { r: 56, g: 189, b: 248 };

function parseHexColor(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return FALLBACK_ACCENT;
  const raw = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return FALLBACK_ACCENT;
}

/** Keep the crew accent; shift brightness / saturation slightly by status. */
function phaseTint(
  base: { r: number; g: number; b: number },
  phase: ParticlePhase,
): { r: number; g: number; b: number } {
  const mix = (t: number, toward: { r: number; g: number; b: number }) => ({
    r: Math.round(base.r + (toward.r - base.r) * t),
    g: Math.round(base.g + (toward.g - base.g) * t),
    b: Math.round(base.b + (toward.b - base.b) * t),
  });
  const brighten = (f: number) => ({
    r: Math.min(255, Math.round(base.r * f)),
    g: Math.min(255, Math.round(base.g * f)),
    b: Math.min(255, Math.round(base.b * f)),
  });
  switch (phase) {
    case 'disabled':
      return mix(0.55, { r: 70, g: 74, b: 84 });
    case 'thinking':
      return mix(0.28, { r: 255, g: 170, b: 60 });
    case 'speaking':
      return brighten(1.18);
    case 'recording':
      return brighten(1.08);
    default:
      return base;
  }
}

const NODE_COUNT = 140;
const NEIGHBORS = 3;
const MAX_FIRES = 18;

function fibonacciSphere(i: number, n: number): Vec3 {
  const t = i + 0.5;
  const y = 1 - (t * 2) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (1 + Math.sqrt(5)) * t;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

function rotateY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function rotateX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function buildEdges(nodes: Node[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const ranked: { j: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      ranked.push({ j, d: dist2(nodes[i].base, nodes[j].base) });
    }
    ranked.sort((a, b) => a.d - b.d);
    for (let k = 0; k < NEIGHBORS && k < ranked.length; k++) {
      const j = ranked[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      // Keep mesh sparse — skip some links for organic look
      if (Math.random() > 0.72) continue;
      seen.add(key);
      edges.push({ a: i, b: j, strength: 0.35 + Math.random() * 0.45 });
    }
  }
  // A few long-range “neural” shortcuts
  for (let n = 0; n < 12; n++) {
    const a = Math.floor(Math.random() * nodes.length);
    const b = Math.floor(Math.random() * nodes.length);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a, b, strength: 0.15 + Math.random() * 0.2 });
  }
  return edges;
}

export function CallJarvisGlobe({
  phase,
  active,
  level = 0,
  accent,
}: {
  phase: ParticlePhase;
  active: boolean;
  /** 0–1 audio level — amplifies spin / fire rate. */
  level?: number;
  /** Crew member accent — globe is tinted to this color. */
  accent?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<ParticlePhase>(phase);
  const activeRef = useRef(active);
  const levelRef = useRef(level);
  const accentRef = useRef(accent);

  phaseRef.current = phase;
  activeRef.current = active;
  levelRef.current = Math.max(0, Math.min(1, level));
  accentRef.current = accent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let yaw = 0;
    let pitch = 0.32;
    let time = 0;
    let last = performance.now();

    const nodes: Node[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        base: fibonacciSphere(i, NODE_COUNT),
        swell: 0,
        brightness: 0.35 + Math.random() * 0.35,
        pulse: Math.random() * Math.PI * 2,
        birth: 0,
        life: 1,
      });
    }
    let edges = buildEdges(nodes);
    const fires: Fire[] = [];
    let colorLerp = { ...FALLBACK_ACCENT };
    let targetColor = { ...FALLBACK_ACCENT };

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function project(v: Vec3): { x: number; y: number; s: number; z: number } {
      const fov = 2.35;
      const depth = 2.6 + v.z;
      const scale = (Math.min(width, height) * 0.38 * fov) / depth;
      return {
        x: width / 2 + v.x * scale,
        y: height / 2 + v.y * scale * 0.98,
        s: scale,
        z: v.z,
      };
    }

    function spawnTransient() {
      // Replace a random node with a “new particle forming” on the sphere.
      const i = Math.floor(Math.random() * nodes.length);
      const n = nodes[i];
      n.base = fibonacciSphere(Math.random() * NODE_COUNT, NODE_COUNT);
      // Normalize
      const len = Math.hypot(n.base.x, n.base.y, n.base.z) || 1;
      n.base.x /= len;
      n.base.y /= len;
      n.base.z /= len;
      n.birth = 1;
      n.life = 1;
      n.swell = 0.18;
      n.brightness = 1;
      // Rewire a few edges touching this node
      edges = edges.filter((e) => e.a !== i && e.b !== i);
      const ranked: { j: number; d: number }[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        ranked.push({ j, d: dist2(n.base, nodes[j].base) });
      }
      ranked.sort((a, b) => a.d - b.d);
      for (let k = 0; k < NEIGHBORS && k < ranked.length; k++) {
        if (Math.random() > 0.55) continue;
        edges.push({ a: i, b: ranked[k].j, strength: 0.5 + Math.random() * 0.4 });
      }
    }

    function maybeFire(rate: number) {
      if (fires.length >= MAX_FIRES) return;
      if (Math.random() > rate) return;
      if (edges.length === 0) return;
      const e = edges[Math.floor(Math.random() * edges.length)];
      const forward = Math.random() > 0.5;
      fires.push({
        from: forward ? e.a : e.b,
        to: forward ? e.b : e.a,
        t: 0,
        speed: 1.6 + Math.random() * 2.4,
      });
      nodes[e.a].brightness = Math.min(1.4, nodes[e.a].brightness + 0.55);
      nodes[e.b].brightness = Math.min(1.4, nodes[e.b].brightness + 0.35);
    }

    function frame(now: number) {
      if (!ctx) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;

      const ph = phaseRef.current;
      const isActive = activeRef.current;
      const lvl = levelRef.current;
      targetColor = phaseTint(parseHexColor(accentRef.current), ph);
      colorLerp.r += (targetColor.r - colorLerp.r) * 0.08;
      colorLerp.g += (targetColor.g - colorLerp.g) * 0.08;
      colorLerp.b += (targetColor.b - colorLerp.b) * 0.08;
      const { r, g, b } = colorLerp;

      // Phase-driven spin / activity
      let spin = 0.22;
      let fireRate = 0.04;
      let breathe = 0.012;
      if (!isActive || ph === 'disabled') {
        spin = 0.05;
        fireRate = 0.008;
        breathe = 0.004;
      } else if (ph === 'thinking') {
        spin = 0.55 + lvl * 0.2;
        fireRate = 0.18 + lvl * 0.15;
        breathe = 0.03;
      } else if (ph === 'recording') {
        spin = 0.35 + lvl * 0.45;
        fireRate = 0.1 + lvl * 0.12;
        breathe = 0.02 + lvl * 0.02;
      } else if (ph === 'speaking') {
        spin = 0.4 + lvl * 0.35;
        fireRate = 0.14 + lvl * 0.2;
        breathe = 0.028 + lvl * 0.03;
      } else {
        spin = 0.28;
        fireRate = 0.055;
      }

      yaw += spin * dt;
      pitch = 0.28 + Math.sin(time * 0.35) * 0.06;

      if (isActive && ph !== 'disabled' && Math.random() < 0.012 + fireRate * 0.04) {
        spawnTransient();
      }
      maybeFire(fireRate);

      // Update fires
      for (let i = fires.length - 1; i >= 0; i--) {
        fires[i].t += fires[i].speed * dt;
        if (fires[i].t >= 1) {
          const to = fires[i].to;
          nodes[to].brightness = Math.min(1.5, nodes[to].brightness + 0.7);
          nodes[to].swell = Math.max(nodes[to].swell, 0.12);
          // Chain reaction while thinking / speaking
          if ((ph === 'thinking' || ph === 'speaking') && fires.length < MAX_FIRES && Math.random() > 0.35) {
            const nextEdges = edges.filter((e) => e.a === to || e.b === to);
            if (nextEdges.length) {
              const ne = nextEdges[Math.floor(Math.random() * nextEdges.length)];
              const next = ne.a === to ? ne.b : ne.a;
              fires.push({ from: to, to: next, t: 0, speed: 1.8 + Math.random() * 2 });
            }
          }
          fires.splice(i, 1);
        }
      }

      const radiusPulse = 1 + Math.sin(time * 2.2) * breathe + (ph === 'speaking' ? lvl * 0.06 : 0);

      // Soft vignette clear
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createRadialGradient(width / 2, height / 2, 8, width / 2, height / 2, Math.max(width, height) * 0.55);
      bg.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},0.07)`);
      bg.addColorStop(0.45, 'rgba(4,8,14,0.15)');
      bg.addColorStop(1, 'rgba(2,4,8,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Outer holographic ring
      const ringR = Math.min(width, height) * 0.42;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(yaw * 0.35);
      ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${ph === 'disabled' ? 0.12 : 0.28})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.ellipse(0, 0, ringR, ringR * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([2, 10]);
      ctx.rotate(-yaw * 0.9);
      ctx.beginPath();
      ctx.ellipse(0, 0, ringR * 0.92, ringR * 0.32, Math.PI / 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      type Proj = { i: number; x: number; y: number; z: number; s: number; br: number; rad: number };
      const projected: Proj[] = [];

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.pulse += dt * (1.5 + n.brightness);
        n.brightness += (0.4 - n.brightness) * 0.04;
        n.swell *= 0.92;
        if (n.birth > 0) n.birth = Math.max(0, n.birth - dt * 1.2);

        let p = n.base;
        p = {
          x: p.x * radiusPulse * (1 + n.swell),
          y: p.y * radiusPulse * (1 + n.swell),
          z: p.z * radiusPulse * (1 + n.swell),
        };
        p = rotateY(p, yaw);
        p = rotateX(p, pitch);
        const pr = project(p);
        const flicker = 0.75 + 0.25 * Math.sin(n.pulse);
        const birthBoost = n.birth * 0.8;
        projected.push({
          i,
          x: pr.x,
          y: pr.y,
          z: pr.z,
          s: pr.s,
          br: (n.brightness * flicker + birthBoost) * (ph === 'disabled' ? 0.45 : 1),
          rad: Math.max(0.8, (1.1 + n.brightness * 1.4 + n.birth * 2) * (pr.s / 90)),
        });
      }

      // Edges (back to front via midpoint z)
      const edgeDraw = edges.map((e) => {
        const pa = projected[e.a];
        const pb = projected[e.b];
        return { e, pa, pb, z: (pa.z + pb.z) * 0.5 };
      });
      edgeDraw.sort((a, b) => a.z - b.z);

      for (const { e, pa, pb } of edgeDraw) {
        const depth = (pa.z + pb.z) * 0.5;
        const alpha = Math.max(0.03, Math.min(0.55, (0.22 + e.strength * 0.35) * (0.55 + depth * 0.35)));
        const dim = ph === 'disabled' ? 0.35 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha * dim})`;
        ctx.lineWidth = depth > 0 ? 1.1 : 0.55;
        ctx.stroke();
      }

      // Fire packets along edges
      for (const f of fires) {
        const pa = projected[f.from];
        const pb = projected[f.to];
        const x = pa.x + (pb.x - pa.x) * f.t;
        const y = pa.y + (pb.y - pa.y) * f.t;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 10);
        glow.addColorStop(0, `rgba(255,255,255,0.95)`);
        glow.addColorStop(0.25, `rgba(${r | 0},${g | 0},${b | 0},0.85)`);
        glow.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,0.9)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes
      projected.sort((a, b) => a.z - b.z);
      for (const p of projected) {
        const alpha = Math.max(0.08, Math.min(1, 0.25 + p.br * 0.55 + p.z * 0.2));
        if (p.br > 0.85 || p.z > 0.2) {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rad * 5);
          glow.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${0.35 * p.br})`);
          glow.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.rad * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.min(255, (r | 0) + 40)},${Math.min(255, (g | 0) + 40)},${Math.min(255, (b | 0) + 50)},${alpha})`;
        ctx.fill();
      }

      // Core spark
      const core = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, 28 + lvl * 20);
      core.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${ph === 'disabled' ? 0.08 : 0.22 + lvl * 0.2})`);
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 40, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(frame);
    }

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
      }}
    />
  );
}
