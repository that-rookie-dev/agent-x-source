/** Shared glass-panel styling for cortex HUD chrome. */
export const MONO = "'JetBrains Mono', monospace";

export const glassPanel = {
  bgcolor: 'rgba(7, 9, 20, 0.78)',
  backdropFilter: 'blur(14px)',
  border: '1px solid rgba(125, 145, 255, 0.14)',
  borderRadius: '10px',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
  color: '#c7d2f0',
  fontFamily: MONO,
} as const;

export const hudLabel = {
  fontFamily: MONO,
  fontSize: '0.55rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(148, 163, 216, 0.75)',
} as const;
