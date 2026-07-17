import { useEffect, useRef, useState } from 'react';

/**
 * SVG overlay that draws PCB-style connection traces from the Voice Agent card
 * (center) to surrounding cards in the bento grid. Each trace is an orthogonal
 * L-shaped path (horizontal then vertical, or vice versa) resembling copper
 * traces on a circuit board. Small dots animate along the traces from the
 * voice agent outward, like data feeding the rest of the system.
 *
 * - Traces are always visible at low opacity
 * - Dots are always animating; they intensify when voice is active
 * - pointer-events: none, z-index: 0
 */

interface Trace {
  /** Polyline points: [x, y, x, y, ...] */
  points: number[];
  key: string;
}

export function VoiceConnectionPulses({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const pulseOffsetRef = useRef<number[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function computeTraces() {
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const cards = container.querySelectorAll('[data-bento-card]');
      const voiceCard = container.querySelector('[data-voice-agent-card]');
      if (!voiceCard) return;
      const voiceRect = voiceCard.getBoundingClientRect();
      const cx = voiceRect.left + voiceRect.width / 2 - containerRect.left;
      const cy = voiceRect.top + voiceRect.height / 2 - containerRect.top;

      const newTraces: Trace[] = [];
      cards.forEach((card, i) => {
        if (card === voiceCard) return;
        const rect = card.getBoundingClientRect();
        const tx = rect.left + rect.width / 2 - containerRect.left;
        const ty = rect.top + rect.height / 2 - containerRect.top;

        // Build an orthogonal L-shaped path: go horizontal first to the
        // target's x, then vertical to the target's y. Add a small midpoint
        // offset so traces don't overlap when multiple cards share an axis.
        const midX = (cx + tx) / 2;
        const midY = (cy + ty) / 2;
        // Alternate between H-then-V and V-then-H for visual variety
        const goHorizontalFirst = Math.abs(tx - cx) > Math.abs(ty - cy);
        const points = goHorizontalFirst
          ? [cx, cy, midX, cy, midX, ty, tx, ty]
          : [cx, cy, cx, midY, tx, midY, tx, ty];
        newTraces.push({ points, key: `trace-${i}` });
      });
      setTraces(newTraces);
      pulseOffsetRef.current = newTraces.map(() => Math.random());
    }

    computeTraces();
    const observer = new ResizeObserver(computeTraces);
    observer.observe(container);

    // Recompute on scroll (cards move within the scrollable container)
    const onScroll = () => computeTraces();
    window.addEventListener('scroll', onScroll, true);

    // Recompute after a delay to let layout settle
    const timeoutId = setTimeout(computeTraces, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      clearTimeout(timeoutId);
    };
  }, []);

  if (traces.length === 0) {
    return <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />;
  }

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {traces.map((trace, i) => {
          const numPulses = 2;
          const pointsStr = trace.points.map((v) => String(v)).join(' ');
          return (
            <g key={trace.key}>
              {/* PCB trace — orthogonal path */}
              <polyline
                points={pointsStr}
                fill="none"
                stroke={active ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.06)'}
                strokeWidth={1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Junction dots at corners */}
              <circle
                cx={trace.points[2]}
                cy={trace.points[3]}
                r={1.5}
                fill={active ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)'}
              />
              <circle
                cx={trace.points[4]}
                cy={trace.points[5]}
                r={1.5}
                fill={active ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)'}
              />
              {/* Animated dots traveling along the trace */}
              {Array.from({ length: numPulses }).map((_, j) => (
                <TraceDot
                  key={`pulse-${i}-${j}`}
                  points={trace.points}
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

/**
 * Dot that animates along a polyline path (array of [x, y, x, y, ...]).
 * The dot position is interpolated along the total path length.
 */
function TraceDot({
  points,
  delay,
  active,
}: {
  points: number[];
  delay: number;
  active: boolean;
}) {
  const ref = useRef<SVGCircleElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    let start: number | null = null;
    const duration = 3000;
    const offset = delay * duration;

    // Precompute segment lengths and total length
    const segs: { dx: number; dy: number; len: number }[] = [];
    let totalLen = 0;
    for (let i = 0; i < points.length - 2; i += 2) {
      const dx = points[i + 2]! - points[i]!;
      const dy = points[i + 3]! - points[i + 1]!;
      const len = Math.sqrt(dx * dx + dy * dy);
      segs.push({ dx, dy, len });
      totalLen += len;
    }

    function step(ts: number) {
      if (start === null) start = ts;
      const elapsed = ((ts - start + offset) % duration) / duration;
      const targetDist = elapsed * totalLen;

      // Find which segment the dot is on
      let accDist = 0;
      let x = points[0]!;
      let y = points[1]!;
      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s]!;
        if (accDist + seg.len >= targetDist) {
          const t = seg.len > 0 ? (targetDist - accDist) / seg.len : 0;
          const segStartX = points[s * 2]!;
          const segStartY = points[s * 2 + 1]!;
          x = segStartX + seg.dx * t;
          y = segStartY + seg.dy * t;
          break;
        }
        accDist += seg.len;
      }

      // Fade in/out at start/end of trace
      const fadeIn = Math.min(elapsed * 5, 1);
      const fadeOut = Math.min((1 - elapsed) * 5, 1);
      const opacity = Math.min(fadeIn, fadeOut) * (active ? 0.5 : 0.2);

      if (ref.current) {
        ref.current.setAttribute('cx', String(x));
        ref.current.setAttribute('cy', String(y));
        ref.current.setAttribute('opacity', String(opacity));
      }
      animationRef.current = requestAnimationFrame(step);
    }
    animationRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationRef.current);
  }, [points, delay, active]);

  return (
    <circle
      ref={ref}
      r={2}
      fill="rgba(59, 130, 246, 0.9)"
    />
  );
}
