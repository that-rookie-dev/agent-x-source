# web-neuron — Neural Brain Visualization

## Multi-Renderer Architecture

The graph visualization supports multiple swappable renderers, selectable via
a side-panel switcher. Each renderer is an adapter implementing the
`GraphRenderer` interface in `src/renderers/types.ts`.

### Available Renderers

| Renderer | Package | Gate | Notes |
|---|---|---|---|
| **nebula** (default) | `three` + `d3-force` | always on | UnrealBloom post-processing, d3-force n-body physics, LOD tiers, OrbitControls, custom point shaders. |
| **sigma** | `sigma` + `graphology` | always on | 2D WebGL, Fibonacci-sphere layout, spring physics, travelling particles. |

### LOD Tiers (Nebula)

The nebula renderer automatically selects a LOD tier based on node count:

| Tier | Node Count | Behavior |
|---|---|---|
| **full** | ≤500 | d3-force n-body simulation with charge, link, collide, and center forces. Real-time physics. |
| **cluster** | 500–5,000 | No physics — uses backend x/y positions directly. Points + edges rendered as-is. |
| **heatmap** | >5,000 | Particle cloud only — no edges. Additive blending for density visualization. |

### Switching & Persistence

- The active renderer is persisted in `localStorage: agx:renderer`.
- Default is `nebula` (three.js + d3-force).
- Switching re-mounts the renderer and re-syncs all data.

### File Layout

```
src/
  renderers/
    types.ts                  # GraphRenderer interface + shared data model
    palette.ts                # NEON colors + category mapping (shared)
    NebulaRenderer.ts         # three.js + d3-force adapter (default)
    SigmaRenderer.ts          # sigma.js adapter (2D fallback)
    graphAnimator.ts          # pulse/birth/decay/edge-fire effects (sigma)
    graphPhysics.ts           # spring physics for drag (sigma)
    sphereLayout.ts           # Fibonacci-sphere galaxy layout (sigma)
    index.ts                  # registry: id → factory
  App.tsx                     # data + WS + state + mount active renderer + HUD + panel + footer
```

### Build

```bash
pnpm --filter @agentx/web-neuron build   # tsc --noEmit && vite build
pnpm --filter @agentx/web-neuron dev     # vite dev server on :3334
```

### Key Dependencies

- `three` ^0.169.0, `@types/three` ^0.169.0 — nebula renderer
- `d3-force` ^3.0.0, `@types/d3-force` — n-body physics for nebula
- `sigma` ^3.0.3, `graphology` ^0.26.0 — sigma renderer
- `react` ^18.3.1, `react-dom` ^18.3.1 — UI shell

### Type Resolution Note

`@types/three` has a broken `exports` field that prevents TypeScript from
finding the type declarations under `moduleResolution: "bundler"`. The
`vite-env.d.ts` file previously contained a manual `declare module 'three'`
stub as a workaround. Now that `@types/three` is installed, the stub has been
removed and the real types are used. If `@types/three` is reinstalled and the
`exports` field reappears, patch `node_modules/@types/three/package.json` to
remove the `exports` field.
