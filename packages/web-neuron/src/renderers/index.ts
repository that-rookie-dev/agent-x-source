// Multi-renderer registry. The active renderer is selected by the App
// based on user preference (localStorage: agx:renderer) and capability.
import { SigmaRenderer } from './SigmaRenderer.ts';
import { NebulaRenderer } from './NebulaRenderer.ts';
import { ForceGraph3DRenderer } from './ForceGraph3DRenderer.ts';
import type { GraphRenderer, RendererId } from './types.ts';

export type { GraphRenderer, RendererId };

export function createRenderer(id: RendererId = 'nebula'): GraphRenderer {
  switch (id) {
    case 'nebula':
      return new NebulaRenderer();
    case 'force3d':
      return new ForceGraph3DRenderer();
    case 'sigma':
    default:
      return new SigmaRenderer();
  }
}

export const AVAILABLE_RENDERERS: { id: RendererId; label: string }[] = [
  { id: 'force3d', label: 'FORCE3D' },
  { id: 'nebula', label: 'NEBULA' },
  { id: 'sigma', label: 'SIGMA' },
];
