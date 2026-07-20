import { useEffect, useRef } from 'react';

/**
 * Particle physics canvas for the Voice Agent card.
 *
 * Renders 80+ particles drifting around a central mic button. Particle behavior
 * changes based on the voice phase:
 *  - idle: slow orbital drift (blue)
 *  - recording: particles converge toward center (green, gravitational pull)
 *  - thinking: spiral orbit (orange)
 *  - speaking: particles radiate outward in waves (purple)
 *  - disabled: minimal drift, dimmed (grey)
 *
 * Also renders a radial gradient glow behind the mic that shifts color with phase.
 */

export type ParticlePhase =
  | 'disabled'
  | 'paused'
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'recording'
  | 'thinking'
  | 'speaking';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  angle: number;
  angularVel: number;
  orbitRadius: number;
  life: number;
  maxLife: number;
}

/** Shared palette for voice + crew-call particle UIs. */
export const PARTICLE_PHASE_COLORS: Record<ParticlePhase, { r: number; g: number; b: number }> = {
  disabled: { r: 150, g: 152, b: 158 }, // colorless grey — offline
  paused: { r: 168, g: 170, b: 176 },   // colorless grey — on hold / disconnected
  connecting: { r: 59, g: 130, b: 246 }, // blue — dialing / reconnecting / loading
  idle: { r: 59, g: 130, b: 246 },       // blue (dashboard standby)
  listening: { r: 34, g: 197, b: 94 },   // green — call listening
  recording: { r: 34, g: 197, b: 94 },   // green — mic active
  thinking: { r: 249, g: 115, b: 22 },   // orange
  speaking: { r: 168, g: 85, b: 247 },   // purple — crew / TTS audio
};

const PHASE_COLORS = PARTICLE_PHASE_COLORS;

const PARTICLE_COUNT = 40;

export function VoiceParticleField({
  phase,
  active,
  level = 0,
  centerRef,
}: {
  phase: ParticlePhase;
  active: boolean;
  /** 0–1 audio level — amplifies motion while user is speaking. */
  level?: number;
  /** Optional ref to an element whose center should be used as the particle origin. */
  centerRef?: React.RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<ParticlePhase>(phase);
  const activeRef = useRef<boolean>(active);
  const levelRef = useRef<number>(level);
  const animationRef = useRef<number>(0);

  phaseRef.current = phase;
  activeRef.current = active;
  levelRef.current = Math.max(0, Math.min(1, level));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let cx = 0;
    let cy = 0;
    let particles: Particle[] = [];
    let time = 0;

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      // Default center to canvas center; if centerRef is provided, use the
      // center of that element relative to the canvas.
      cx = width / 2;
      cy = height / 2;
      if (centerRef?.current) {
        const elRect = centerRef.current.getBoundingClientRect();
        cx = elRect.left + elRect.width / 2 - rect.left;
        cy = elRect.top + elRect.height / 2 - rect.top;
      }
    }

    function initParticles() {
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const orbitRadius = 30 + Math.random() * 80;
        const angle = Math.random() * Math.PI * 2;
        particles.push({
          x: cx + Math.cos(angle) * orbitRadius,
          y: cy + Math.sin(angle) * orbitRadius,
          vx: 0,
          vy: 0,
          radius: 1 + Math.random() * 2.5,
          baseRadius: 1 + Math.random() * 2.5,
          angle,
          angularVel: 0.002 + Math.random() * 0.008,
          orbitRadius,
          life: Math.random(),
          maxLife: 0.5 + Math.random() * 1.5,
        });
      }
    }

    resize();
    initParticles();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      initParticles();
    });
    resizeObserver.observe(canvas);
    if (centerRef?.current) resizeObserver.observe(centerRef.current);

    // On scroll/resize, only recompute the center position — don't
    // reinitialize particles (that causes a visible jump/flash).
    const onWindowChange = () => {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      cx = width / 2;
      cy = height / 2;
      if (centerRef?.current) {
        const elRect = centerRef.current.getBoundingClientRect();
        cx = elRect.left + elRect.width / 2 - rect.left;
        cy = elRect.top + elRect.height / 2 - rect.top;
      }
    };
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    function draw() {
      if (!ctx || !canvas) return;
      const currentPhase = phaseRef.current;
      const isActive = activeRef.current;
      const color = PHASE_COLORS[currentPhase];
      const isHoldLike = currentPhase === 'paused' || currentPhase === 'disabled';
      const intensity = isHoldLike ? 0.35 : (isActive ? 1 : 0.3);
      const lvl = levelRef.current;

      // Clear with subtle trail effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, width, height);

      // Draw radial gradient glow behind mic
      const glowRadius = Math.min(width, height) * 0.45;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      const glowAlpha = isHoldLike ? 0.02 : (isActive ? 0.08 : 0.03);
      gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${glowAlpha})`);
      gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${glowAlpha * 0.4})`);
      gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      time += 0.016;

      // Update and draw particles
      for (const p of particles) {
        p.life += 0.016;

        switch (currentPhase) {
          case 'disabled':
          case 'paused': {
            // Slow colorless roam around center (hold / disconnected).
            p.angle += p.angularVel * 0.22;
            const roam = p.orbitRadius + Math.sin(time * 0.35 + p.angle) * 4;
            p.x = cx + Math.cos(p.angle) * roam;
            p.y = cy + Math.sin(p.angle) * roam;
            break;
          }
          case 'connecting':
          case 'idle': {
            // Blue loading / standby orbit
            p.angle += p.angularVel;
            p.x = cx + Math.cos(p.angle) * p.orbitRadius;
            p.y = cy + Math.sin(p.angle) * p.orbitRadius;
            break;
          }
          case 'listening':
          case 'recording': {
            // Gravitational pull toward center — stronger with mic level
            const energy = 0.35 + lvl * 1.4;
            const dx = cx - p.x;
            const dy = cy - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const pull = 0.12 * energy;
            p.vx += (dx / dist) * pull + (Math.random() - 0.5) * 0.35 * lvl;
            p.vy += (dy / dist) * pull + (Math.random() - 0.5) * 0.35 * lvl;
            // Damping
            p.vx *= 0.9;
            p.vy *= 0.9;
            p.x += p.vx * energy;
            p.y += p.vy * energy;
            // If too close, reset to orbit (radius reacts to volume)
            if (dist < 12 + lvl * 10) {
              p.angle = Math.random() * Math.PI * 2;
              p.orbitRadius = 28 + Math.random() * (55 + lvl * 50);
              p.x = cx + Math.cos(p.angle) * p.orbitRadius;
              p.y = cy + Math.sin(p.angle) * p.orbitRadius;
              p.vx = 0;
              p.vy = 0;
            }
            break;
          }
          case 'thinking': {
            // Spiral orbit
            p.angle += p.angularVel * 1.5;
            const spiralRadius = p.orbitRadius + Math.sin(time * 2 + p.angle) * 10;
            p.x = cx + Math.cos(p.angle) * spiralRadius;
            p.y = cy + Math.sin(p.angle) * spiralRadius;
            break;
          }
          case 'speaking': {
            // Radiate outward in waves — driven by playback level
            const waveSpeed = 24 + lvl * 40;
            const waveRadius = ((time * waveSpeed + p.maxLife * 100) % (90 + lvl * 50));
            const base = 18 + lvl * 14;
            p.x = cx + Math.cos(p.angle) * (base + waveRadius);
            p.y = cy + Math.sin(p.angle) * (base + waveRadius);
            if (waveRadius > 80 + lvl * 40) {
              p.angle = Math.random() * Math.PI * 2;
              p.maxLife = 0.5 + Math.random() * 1.5;
            }
            break;
          }
        }

        // Pulsing radius
        const pulseRadius = p.baseRadius + Math.sin(time * 3 + p.angle) * (isHoldLike ? 0.2 : 0.5);

        // Draw particle with glow
        const alpha = intensity * (isHoldLike ? 0.28 : (0.4 + Math.sin(time * 2 + p.angle) * 0.2));
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.fill();

        // Glow halo
        if (isActive && !isHoldLike) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, pulseRadius * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.15})`;
          ctx.fill();
        }
      }

      // Draw connection lines between nearby particles (neural network effect)
      if (isActive && !isHoldLike) {
        const maxDist = 60;
        const maxDistSq = maxDist * maxDist;
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i]!.x - particles[j]!.x;
            const dy = particles[i]!.y - particles[j]!.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < maxDistSq) {
              const dist = Math.sqrt(distSq);
              const lineAlpha = (1 - dist / maxDist) * 0.08 * intensity;
              ctx.beginPath();
              ctx.moveTo(particles[i]!.x, particles[i]!.y);
              ctx.lineTo(particles[j]!.x, particles[j]!.y);
              ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${lineAlpha})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
      resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
