// Renderer registry. The active renderer is selected by the App
// based on user preference (localStorage: agx:renderer).
import { ForceGraph3DRenderer } from './ForceGraph3DRenderer.ts';
import type { GraphRenderer, RendererId } from './types.ts';

export type { GraphRenderer, RendererId };

export function createRenderer(_id?: RendererId): GraphRenderer {
  return new ForceGraph3DRenderer();
}

export const AVAILABLE_RENDERERS: { id: RendererId; label: string }[] = [
  { id: 'force3d', label: 'FORCE3D' },
];
