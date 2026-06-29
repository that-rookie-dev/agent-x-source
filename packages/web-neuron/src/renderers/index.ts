// Renderer registry: maps a RendererId to a factory, gated by capability.
// force3d is always available (default). Cosmograph is gated on WebGPU + GPU.
import { getCapabilities, type CapabilityReport } from './capability.ts';
import { CosmographRenderer } from './CosmographRenderer.ts';
import { ForceGraph3DRenderer } from './ForceGraph3DRenderer.ts';
import type { GraphRenderer, RendererId } from './types.ts';

export type { RendererId };

export interface RendererDescriptor {
  id: RendererId;
  label: string;
  available: boolean;
  /** Why it is unavailable, shown as a tooltip in the footer switcher. */
  reason?: string;
  /** Factory, or null when unavailable. */
  create: (() => GraphRenderer) | null;
}

export function listRenderers(caps: CapabilityReport = getCapabilities()): RendererDescriptor[] {
  return [
    {
      id: 'force3d',
      label: 'FORCE-3D',
      available: true,
      create: () => new ForceGraph3DRenderer(),
    },
    {
      id: 'cosmograph',
      label: 'COSMOGRAPH',
      available: caps.cosmograph,
      reason: caps.cosmographReason,
      create: caps.cosmograph ? () => new CosmographRenderer() : null,
    },
  ];
}

/** The default renderer to boot with (always force3d). */
export const DEFAULT_RENDERER_ID: RendererId = 'force3d';

/** Resolve a persisted choice against current capabilities, falling back to force3d. */
export function resolveRendererId(
  preferred: RendererId | null,
  caps: CapabilityReport = getCapabilities(),
): RendererId {
  if (preferred) {
    const desc = listRenderers(caps).find((r) => r.id === preferred);
    if (desc?.available && desc.create) return preferred;
  }
  return DEFAULT_RENDERER_ID;
}

export function createRenderer(id: RendererId, caps: CapabilityReport = getCapabilities()): GraphRenderer {
  const desc = listRenderers(caps).find((r) => r.id === id);
  if (desc?.available && desc.create) return desc.create();
  // Safety net: never return null — always fall back to force3d.
  return new ForceGraph3DRenderer();
}
