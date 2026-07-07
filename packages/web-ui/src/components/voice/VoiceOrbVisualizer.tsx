import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import { colors } from '../../theme';

type OrbPhase = 'idle' | 'listening' | 'processing' | 'speaking';

interface VoiceOrbVisualizerProps {
  phase: OrbPhase;
  level?: number;
}

const NODES = 12;

export function VoiceOrbVisualizer({ phase, level = 0 }: VoiceOrbVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 160;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    let t = 0;
    const accent = phase === 'speaking'
      ? colors.accent.green
      : phase === 'listening'
        ? colors.accent.cyan
        : phase === 'processing'
          ? colors.accent.orange
          : colors.accent.blue;

    const draw = () => {
      t += 0.04;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const pulse = phase === 'idle' ? 0.15 : 0.35 + level * 0.65;
      const baseR = 28 + pulse * 10;

      ctx.beginPath();
      ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx.strokeStyle = `${accent}55`;
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < NODES; i += 1) {
        const angle = (i / NODES) * Math.PI * 2 + t * (phase === 'processing' ? 0.8 : 0.35);
        const orbit = baseR + 14 + Math.sin(t * 2 + i) * (4 + level * 12);
        const x = cx + Math.cos(angle) * orbit;
        const y = cy + Math.sin(angle) * orbit;
        const nodeR = 2 + (phase === 'speaking' ? 1.5 : 1) + level * 2.5;

        ctx.beginPath();
        ctx.arc(x, y, nodeR, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.35 + level * 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `${accent}22`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 6 + level * 4, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();

      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [phase, level]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
      <canvas ref={canvasRef} aria-hidden />
    </Box>
  );
}
