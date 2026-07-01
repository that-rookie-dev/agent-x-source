# web-neuron — Neural Brain Visualization

## Renderer Architecture

The graph visualization uses a single renderer: **FORCE3D** (3d-force-graph via
`react-force-graph-3d`). The renderer is an adapter implementing the
`GraphRenderer` interface in `src/renderers/types.ts`.

### Renderer

| Renderer | Package | Notes |
|---|---|---|
| **force3d** (default) | `react-force-graph-3d` (wraps `3d-force-graph` + `three`) | 3D force-directed layout, directional travelling particles on links, auto-color by category, dark background, zoom/pan/orbit, node drag. |

### File Layout

```
src/
  renderers/
    types.ts                  # GraphRenderer interface + shared data model
    palette.ts                # NEON colors + category mapping (shared)
    ForceGraph3DRenderer.ts   # react-force-graph-3d adapter
    index.ts                  # registry: id → factory
  App.tsx                     # data + WS + state + mount renderer + HUD + panel + footer
```

### Build

```bash
pnpm --filter @agentx/web-neuron build   # tsc --noEmit && vite build
pnpm --filter @agentx/web-neuron dev     # vite dev server on :3334
```

### Key Dependencies

- `react-force-graph-3d` ^1.29.1 — 3D force-directed graph (bundles `3d-force-graph` + `three`)
- `react` ^18.3.1, `react-dom` ^18.3.1 — UI shell
