# web-neuron — Neural Brain Visualization

## Multi-Renderer Architecture

The graph visualization supports multiple swappable renderers, selectable via
a bottom-footer switcher. Each renderer is an adapter implementing the
`GraphRenderer` interface in `src/renderers/types.ts`.

### Available Renderers

| Renderer | Package | Gate | Notes |
|---|---|---|---|
| **force3d** (default) | `3d-force-graph` + `three` | always on | UnrealBloom, travelling particles, auto-rotate. Backend Louvain x/y layout. |
| **cosmograph** | `@cosmograph/cosmograph` | WebGPU + ≥8 cores | GPU force layout + clustering. Debounced flush (600ms) for WS events. Uses Cosmograph's default animation/controls; only colors are mapped to the AGENT-X palette. |

### Switching & Persistence

- The active renderer is persisted in `localStorage: agx:renderer`.
- On boot, the persisted choice is validated against current capabilities; if
  unavailable, falls back to `force3d`.
- The `⚙ COSMO FORCE` toggle in the footer force-enables Cosmograph regardless
  of capability detection (for testing on machines without WebGPU).
- Switching is manual only — no auto-fallback on low FPS.

### File Layout

```
src/
  renderers/
    types.ts                  # GraphRenderer interface + shared data model
    palette.ts                # NEON colors + category mapping (shared)
    capability.ts             # WebGPU / concurrency gating
    ForceGraph3DRenderer.ts   # default adapter (extracted from original App.tsx)
    CosmographRenderer.ts     # GPU galaxy adapter (debounced flush)
    index.ts                  # registry: id → factory, capability-gated
  components/
    RendererSwitcher.tsx      # bottom footer with segmented control + ⚙ override
  App.tsx                     # data + WS + state + mount active renderer + HUD + panel + footer
```

### Build

```bash
pnpm --filter @agentx/web-neuron build   # tsc --noEmit && vite build
pnpm --filter @agentx/web-neuron dev     # vite dev server on :3334
```

### Key Dependencies

- `3d-force-graph` ^1.71.2, `three` ^0.160.0 — force3d renderer
- `@cosmograph/cosmograph` 2.3.2, `@cosmograph/react` 2.3.2 — Cosmograph renderer
- `gl-bench` 1.0.42 — required by `@cosmos.gl/graph` (Cosmograph dep); the
  vite alias force-resolves to its ESM build to avoid UMD interop issues
