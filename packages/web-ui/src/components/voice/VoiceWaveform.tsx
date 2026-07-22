import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import { colors, getActiveScheme, resolveColor } from '../../theme';
import { commsTheme } from './voice-comms-theme';

export interface VoiceWaveformProps {
  level?: number;
  active?: boolean;
  accent?: string;
  bars?: number;
  height?: number;
}

export function VoiceWaveform({
  level = 0,
  active = false,
  accent = commsTheme.operator,
  bars = 28,
  height = 56,
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  levelRef.current = level;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 240;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let frame = 0;
    let raf = 0;
    // Canvas can't parse var()/color-mix tokens — resolve once per mount.
    const accentColor = resolveColor(accent);
    const idleColor = resolveColor(colors.ink);

    const draw = () => {
      frame += 1;
      const lvl = levelRef.current;
      const on = activeRef.current;
      const light = getActiveScheme() === 'light';
      ctx.clearRect(0, 0, width, height);

      const gap = 3;
      const barW = Math.max(2, (width - gap * (bars - 1)) / bars);
      const mid = height / 2;

      for (let i = 0; i < bars; i += 1) {
        const t = frame * 0.06 + i * 0.35;
        const wobble = on ? Math.abs(Math.sin(t)) * 0.35 + 0.15 : 0.06;
        const h = on
          ? Math.max(3, (wobble + lvl * 0.85) * height * (0.35 + (i % 5) * 0.04))
          : 2;
        const x = i * (barW + gap);
        ctx.fillStyle = on ? accentColor : idleColor;
        ctx.globalAlpha = on
          ? (light ? 0.5 : 0.35) + lvl * 0.55
          : (light ? 0.12 : 0.03);
        ctx.fillRect(x, mid - h / 2, barW, h);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [accent, bars, height]);

  return (
    <Box sx={{ width: '100%', height, opacity: active ? 1 : 0.45, transition: 'opacity 0.25s' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden />
    </Box>
  );
}
