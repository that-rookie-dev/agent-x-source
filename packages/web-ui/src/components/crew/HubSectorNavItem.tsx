import { useLayoutEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { keyframes } from '@mui/material/styles';
import { crewTheme } from '../../styles/crew-theme';
import { alphaColor } from '../../theme';

interface HubSectorNavItemProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}

/** Single-line sector nav row with hover marquee when label overflows. */
export function HubSectorNavItem({ label, icon, selected, onClick }: HubSectorNavItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [hovered, setHovered] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    setOverflowPx(Math.max(0, text.scrollWidth - container.clientWidth));
  }, [label]);

  const animate = hovered && overflowPx > 0;
  const scrollSec = Math.max(1.8, overflowPx / 42);
  const marqueeKeyframes = keyframes`
    0%, 12% { transform: translateX(0); }
    44%, 56% { transform: translateX(calc(-1 * var(--marquee-shift, 0px))); }
    88%, 100% { transform: translateX(0); }
  `;

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        height: 32,
        mb: 0.25,
        px: 0.75,
        borderRadius: '6px',
        cursor: 'pointer',
        userSelect: 'none',
        color: selected ? crewTheme.bg.void : crewTheme.text.secondary,
        bgcolor: selected ? crewTheme.text.primary : 'transparent',
        '&:hover': {
          bgcolor: selected ? alphaColor(crewTheme.text.primary, 0.85) : crewTheme.bg.cardHover,
        },
      }}
    >
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 18,
        height: 18,
        '& svg': { fontSize: 15 },
      }}>
        {icon}
      </Box>
      <Box ref={containerRef} sx={{ flex: 1, minWidth: 0, overflow: 'hidden', height: 16, lineHeight: '16px' }}>
        <Box
          component="span"
          ref={textRef}
          sx={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            fontSize: '0.58rem',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.2px',
            transform: 'translateX(0)',
            '--marquee-shift': `${overflowPx}px`,
            animation: animate
              ? `${marqueeKeyframes} ${scrollSec * 2.4}s ease-in-out infinite`
              : 'none',
          }}
        >
          {label}
        </Box>
      </Box>
    </Box>
  );
}
