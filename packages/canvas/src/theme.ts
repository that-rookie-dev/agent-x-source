export interface AgentXThemeTokens {
  bg: { primary: string; secondary: string; tertiary: string; hover: string };
  border: { default: string; strong: string };
  text: { primary: string; secondary: string; tertiary: string; dim: string };
  accent: { blue: string; green: string; orange: string; red: string; purple: string; cyan: string };
  font: { sans: string; mono: string };
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function readAgentXTheme(): AgentXThemeTokens {
  return {
    bg: {
      primary: cssVar('--ax-bg-primary', '#030308'),
      secondary: cssVar('--ax-bg-secondary', '#0a0a12'),
      tertiary: cssVar('--ax-bg-tertiary', '#12121c'),
      hover: cssVar('--ax-bg-hover', '#1c1c28'),
    },
    border: {
      default: cssVar('--ax-border-default', '#242432'),
      strong: cssVar('--ax-border-strong', '#343448'),
    },
    text: {
      primary: cssVar('--ax-text-primary', '#f2f3f7'),
      secondary: cssVar('--ax-text-secondary', '#b4b8c4'),
      tertiary: cssVar('--ax-text-tertiary', '#8b90a0'),
      dim: cssVar('--ax-text-dim', '#656878'),
    },
    accent: {
      blue: cssVar('--ax-accent-blue', '#7dd3fc'),
      green: cssVar('--ax-accent-green', '#4ade80'),
      orange: cssVar('--ax-accent-orange', '#fbbf24'),
      red: cssVar('--ax-accent-red', '#f87171'),
      purple: cssVar('--ax-accent-purple', '#c4b5fd'),
      cyan: cssVar('--ax-accent-cyan', '#67e8f9'),
    },
    font: {
      sans: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', monospace",
    },
  };
}

/** Theme tokens from Agent-X CSS variables — re-reads on each render so dark/light switches apply. */
export function useAgentXTheme(): AgentXThemeTokens {
  return readAgentXTheme();
}
