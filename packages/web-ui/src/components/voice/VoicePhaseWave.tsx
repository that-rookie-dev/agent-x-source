import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import { getActiveScheme, resolveColor } from '../../theme';

export type WaveMode = 'listening' | 'speaking' | 'idle';

/**
 * Phase-reactive wave field around the voice mic.
 * Listening → expanding concentric rings (green).
 * Speaking → flowing aurora ribbons (purple).
 */
export function VoicePhaseWave({
  mode,
  level = 0,
  accent,
  size = 160,
}: {
  mode: WaveMode;
  level?: number;
  accent: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  modeRef.current = mode;
  levelRef.current = Math.max(0, Math.min(1, level));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const color = resolveColor(accent);
    let frame = 0;
    let raf = 0;

    const draw = () => {
      frame += 1;
      const m = modeRef.current;
      const lvl = levelRef.current;
      const light = getActiveScheme() === 'light';
      const alphaBoost = light ? 1.35 : 1;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;

      if (m === 'listening') {
        const rings = 4;
        for (let i = 0; i < rings; i += 1) {
          const cycle = ((frame * 0.018) + i * 0.22) % 1;
          const radius = 18 + cycle * (size * 0.42) * (0.55 + lvl * 0.45);
          const alpha = (1 - cycle) * (0.18 + lvl * 0.45) * alphaBoost;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.globalAlpha = Math.min(0.85, alpha);
          ctx.lineWidth = 1.5 + (1 - cycle) * 1.5;
          ctx.stroke();
        }
        // Soft core bloom
        const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 28 + lvl * 18);
        g.addColorStop(0, color);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = (0.12 + lvl * 0.2) * alphaBoost;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 36, 0, Math.PI * 2);
        ctx.fill();
      } else if (m === 'speaking') {
        const bands = 3;
        for (let b = 0; b < bands; b += 1) {
          ctx.beginPath();
          const amp = (6 + lvl * 22) * (1 - b * 0.18);
          const yBase = cy + (b - 1) * 10;
          for (let x = 8; x <= size - 8; x += 2) {
            const t = x * 0.045 + frame * 0.08 + b * 1.1;
            const y = yBase
              + Math.sin(t) * amp
              + Math.sin(t * 1.7 + frame * 0.03) * amp * 0.35;
            if (x === 8) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = color;
          ctx.globalAlpha = Math.min(0.9, (0.22 + lvl * 0.4 - b * 0.05) * alphaBoost);
          ctx.lineWidth = 1.6 - b * 0.25;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        // Vertical energy ticks
        for (let i = 0; i < 16; i += 1) {
          const x = 16 + (i / 15) * (size - 32);
          const pulse = Math.abs(Math.sin(frame * 0.09 + i * 0.4));
          const h = (4 + pulse * (10 + lvl * 18));
          ctx.globalAlpha = Math.min(0.85, (0.12 + pulse * 0.35 * (0.4 + lvl)) * alphaBoost);
          ctx.fillStyle = color;
          ctx.fillRect(x - 1, cy - h / 2, 2, h);
        }
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [accent, size]);

  if (mode === 'idle') return null;

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
    </Box>
  );
}
