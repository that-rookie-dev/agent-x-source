import { useEffect, useRef, useState } from 'react';

/**
 * SVG overlay that draws subtle connection lines from the Voice Agent card
 * (center) to surrounding cards in the bento grid. Pulses (small dots)
 * travel along the lines outward, like data feeding from the voice agent
 * to the rest of the system.
 *
 * - Lines are always visible at very low opacity (0.04)
 * - Pulses are always animating at low opacity (0.15)
 * - When voice is active, both intensify (lines 0.08, pulses 0.35)
 *
 * This is a subtle decorative detail — pointer-events: none, z-index: 0.
 */
export function VoiceConnectionPulses({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; key: string }[]>([]);
  const animationRef = useRef<number>(0);
  const pulseOffsetRef = useRef<number[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function computeLines() {
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const cards = container.querySelectorAll('[data-bento-card]');
      // Find the voice agent card (centerpiece)
      const voiceCard = container.querySelector('[data-voice-agent-card]');
      if (!voiceCard) return;
      const voiceRect = voiceCard.getBoundingClientRect();
      const cx = voiceRect.left + voiceRect.width / 2 - containerRect.left;
      const cy = voiceRect.top + voiceRect.height / 2 - containerRect.top;

      const newLines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
      cards.forEach((card, i) => {
        if (card === voiceCard) return;
        const rect = card.getBoundingClientRect();
        const tx = rect.left + rect.width / 2 - containerRect.left;
        const ty = rect.top + rect.height / 2 - containerRect.top;
        newLines.push({ x1: cx, y1: cy, x2: tx, y2: ty, key: `line-${i}` });
      });
      setLines(newLines);
      pulseOffsetRef.current = newLines.map(() => Math.random());
    }

    computeLines();
    const observer = new ResizeObserver(computeLines);
    observer.observe(container);

    // Recompute after a delay to let layout settle
    const timeoutId = setTimeout(computeLines, 500);

    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let time = 0;
    function animate() {
      time += 0.008;
      const pulses = document.querySelectorAll('[data-pulse]');
      pulses.forEach((el, i) => {
        const offset = pulseOffsetRef.current[i] ?? 0;
        const progress = ((time + offset) % 1);
        const pulseEl = el as SVGElement;
        pulseEl.setAttribute('data-progress', String(progress));
      });
      animationRef.current = requestAnimationFrame(animate);
    }
    animate();
    return () => cancelAnimationFrame(animationRef.current);
  }, [lines]);

  if (lines.length === 0) {
    return <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />;
  }

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {lines.map((line, i) => {
          const numPulses = 3;
          return (
            <g key={line.key}>
              {/* Connection line */}
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={active ? 'rgba(59, 130, 246, 0.08)' : 'rgba(59, 130, 246, 0.04)'}
                strokeWidth={1}
                strokeDasharray="4 8"
              />
              {/* Pulses traveling along the line */}
              {Array.from({ length: numPulses }).map((_, j) => (
                <PulseDot
                  key={`pulse-${i}-${j}`}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  delay={(j / numPulses) + (pulseOffsetRef.current[i] ?? 0)}
                  active={active}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PulseDot({
  x1, y1, x2, y2, delay, active,
}: {
  x1: number; y1: number; x2: number; y2: number; delay: number; active: boolean;
}) {
  const ref = useRef<SVGCircleElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    let start: number | null = null;
    const duration = 2500;
    const offset = delay * duration;

    function step(ts: number) {
      if (start === null) start = ts;
      const elapsed = ((ts - start + offset) % duration) / duration;
      const x = x1 + (x2 - x1) * elapsed;
      const y = y1 + (y2 - y1) * elapsed;
      // Fade in/out
      const fadeIn = Math.min(elapsed * 4, 1);
      const fadeOut = Math.min((1 - elapsed) * 4, 1);
      const opacity = Math.min(fadeIn, fadeOut) * (active ? 0.35 : 0.12);
      if (ref.current) {
        ref.current.setAttribute('cx', String(x));
        ref.current.setAttribute('cy', String(y));
        ref.current.setAttribute('opacity', String(opacity));
      }
      animationRef.current = requestAnimationFrame(step);
    }
    animationRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationRef.current);
  }, [x1, y1, x2, y2, delay, active]);

  return (
    <circle
      ref={ref}
      r={1.5}
      fill="rgba(59, 130, 246, 0.8)"
      data-pulse
    />
  );
}
