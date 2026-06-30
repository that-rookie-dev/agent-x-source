// Shared neon palette + category colours used by every renderer adapter.
// Keeping this in one place lets each renderer apply the SAME colour mapping
// while using its own default animation / cluster formation / controls.

// NEON palette — cohesive cyan/blue neon family that blooms to a white-hot core.
export const NEON = {
  cyan: '#7df9ff',
  brightCyan: '#aef6ff',
  blue: '#1e90ff',
  edge: '#4a9eff',
  edgeBright: '#8fd4ff',
  hot: '#ffffff',
  void: '#02060f',
  // Session-highlight palette: selected cluster glows orange, the rest fades back.
  orange: '#ff7300',
  dimNode: '#1a2a40',
  dimEdge: '#0c1828',
} as const;

// Category → neon hue. Hues are kept distinct enough to differentiate
// categories while staying "holographic".
export const CATEGORY_COLORS: Record<string, string> = {
  persona: '#4dd2ff',
  tool: '#00e5ff',
  episodic: '#7df9ff',
  semantic: '#34b3f1',
  source_doc: '#9b8cff',
  system: '#cfefff',
};

export const CATEGORY_NAMES: Record<string, string> = {
  persona: 'Persona',
  tool: 'Tool',
  episodic: 'Episodic',
  semantic: 'Semantic',
  source_doc: 'Source Doc',
  system: 'System',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#ffffff';
}
