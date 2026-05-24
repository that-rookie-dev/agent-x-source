/**
 * Agent-X Space Theme — Centralized color palette.
 * Deep space aesthetic with cyan/purple/green accents.
 */

export const SPACE_THEME = {
  // Primary palette
  primary: '#00D4FF',       // Deep cyan — borders, headings, active elements
  primaryDim: '#0097B2',    // Muted cyan — secondary elements
  accent: '#B388FF',        // Nebula purple — highlights, special elements
  accentDim: '#7C4DFF',     // Deep purple

  // Backgrounds
  background: '#0D1117',    // Deep space black
  surface: '#161B22',       // Slightly lighter panel
  surfaceHover: '#1C2128',  // Hover/active state

  // Text
  text: '#E6EDF3',          // Star white — primary text
  textDim: '#7D8590',       // Moonlight gray — secondary text
  textMuted: '#484F58',     // Faint text

  // Borders
  border: '#30363D',        // Subtle borders
  borderActive: '#00D4FF',  // Active/focused borders

  // Status colors
  success: '#69F0AE',       // Stellar green
  warning: '#FFD740',       // Solar amber
  error: '#FF5252',         // Mars red
  info: '#B388FF',          // Nebula purple (info = accent)

  // Token bar
  tokenLow: '#69F0AE',     // Green (< 50%)
  tokenMedium: '#FFD740',  // Amber (50-80%)
  tokenHigh: '#FF5252',    // Red (> 80%)
  tokenGreen: '#69F0AE',
  tokenAmber: '#FFD740',
  tokenRed: '#FF5252',
} as const;
