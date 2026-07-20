/**
 * Neural Cortex color language.
 *
 * Node color = memory category (what kind of thought it is).
 * Nebula tint = Louvain community (which brain region it lives in).
 * All values exist both as Pixi hex numbers and CSS strings for the HUD.
 */
import type { CortexNode } from './api';

export interface CategoryStyle {
  name: string;
  css: string;
  hex: number;
  /** Bright core tint (slightly whitened for the hot center). */
  coreHex: number;
}

export const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  episodic: { name: 'Episodic', css: '#22d3ee', hex: 0x22d3ee, coreHex: 0xbdf3ff },
  semantic: { name: 'Semantic', css: '#a78bfa', hex: 0xa78bfa, coreHex: 0xe4d9ff },
  source_doc: { name: 'Knowledge', css: '#60a5fa', hex: 0x60a5fa, coreHex: 0xd6e8ff },
  tool: { name: 'Skills', css: '#34d399', hex: 0x34d399, coreHex: 0xc9f7e5 },
  persona: { name: 'Persona', css: '#fb7185', hex: 0xfb7185, coreHex: 0xffd9de },
  system: { name: 'System', css: '#fbbf24', hex: 0xfbbf24, coreHex: 0xfff3c9 },
};

export const FALLBACK_CATEGORY: CategoryStyle = {
  name: 'Memory', css: '#94a3b8', hex: 0x94a3b8, coreHex: 0xe2e8f0,
};

export function categoryStyle(category: string | null | undefined): CategoryStyle {
  return (category && CATEGORY_STYLES[category]) || FALLBACK_CATEGORY;
}

/**
 * Deterministic community hue via golden-angle rotation — adjacent community
 * ids land far apart on the wheel so neighboring nebulas never blur together.
 */
export function communityHue(communityId: string): number {
  let h = 0;
  for (let i = 0; i < communityId.length; i++) h = (h * 31 + communityId.charCodeAt(i)) >>> 0;
  return (h * 137.508) % 360;
}

export function hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export function communityTint(communityId: string): number {
  return hslToHex(communityHue(communityId), 0.75, 0.55);
}

/** Node world radius from importance signals — log-scaled so hubs pop without dwarfing. */
export function nodeRadius(node: Pick<CortexNode, 'accessCount' | 'confidence'>): number {
  const activity = Math.log2(1 + (node.accessCount ?? 0)) * 1.1;
  const conf = (node.confidence ?? 0.5) * 1.4;
  return Math.min(9, Math.max(2.4, 2.4 + activity + conf));
}

export const CORTEX_BG = 0x04050d;
export const CORTEX_BG_CSS = '#04050d';
