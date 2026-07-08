/** Third-party service brand colors — stable across light/dark schemes. */
export const brands = {
  telegram: '#0088cc',
  discord: '#5865f2',
  slack: '#ecb22e',
  youtube: '#ff0000',
  imdb: '#f5c518',
  instagram: '#E1306C',
} as const;

/** Hyperdrive mode accent palette (intentionally distinct from the main theme). */
export const hyperdrive = {
  magenta: '#ff00ff',
  cyan: '#00ffff',
  bg: '#0a0010',
  panel: '#1a0020',
  hover: '#ff40ff',
  warning: '#ff4444',
} as const;

/** Distinct hues for @mentions and crew roster chips. */
export const crewPalette = [
  '#7dd3fc',
  '#4ade80',
  '#fbbf24',
  '#f87171',
  '#c4b5fd',
  '#67e8f9',
  '#fb923c',
  '#a78bfa',
] as const;
