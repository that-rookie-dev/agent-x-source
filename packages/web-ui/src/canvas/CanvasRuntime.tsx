import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import * as React from 'react';
import type * as AgentXCanvasModule from '@agentx/canvas';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { colors } from '../theme';

declare global {
  interface Window {
    __AGENTX_CANVAS_HOST__?: { React: typeof React; AgentXCanvas: typeof AgentXCanvasModule };
    __agentx_canvas_bundle__?: ComponentType | { default?: ComponentType };
  }
}

function resolveCanvasComponent(bundle: unknown): ComponentType | null {
  if (!bundle) return null;
  if (typeof bundle === 'function') return bundle as ComponentType;
  if (typeof bundle === 'object' && bundle !== null) {
    const obj = bundle as Record<string, unknown>;
    if (typeof obj.default === 'function') return obj.default as ComponentType;
    // esbuild export helper shape
    for (const key of Object.keys(obj)) {
      if (key === 'default' && typeof obj[key] === 'function') return obj[key] as ComponentType;
    }
  }
  return null;
}

async function loadCompiledCanvas(compiledJs: string): Promise<ComponentType> {
  const AgentXCanvas = await import('@agentx/canvas');
  window.__AGENTX_CANVAS_HOST__ = { React, AgentXCanvas };
  try {
    // Server-validated + esbuild-compiled bundle only
    const runner = new Function(compiledJs + '\n;return globalThis.__agentx_canvas_bundle__;');
    const bundle = runner();
    const Comp = resolveCanvasComponent(bundle);
    if (!Comp) throw new Error('Canvas bundle has no default export');
    return Comp;
  } finally {
    delete window.__agentx_canvas_bundle__;
  }
}

class CanvasRuntimeBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  render() {
    if (this.state.error) {
      return (
        <Typography sx={{ color: colors.accent.red, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" }}>
          Canvas runtime error: {this.state.error}
        </Typography>
      );
    }
    return this.props.children;
  }
}

export function CanvasRuntime({
  compiledJs,
  compileError,
}: {
  compiledJs?: string;
  compileError?: string | null;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComponent(null);
    setLoadError(null);
    if (!compiledJs) return;
    void loadCompiledCanvas(compiledJs)
      .then((Comp) => {
        if (!cancelled) setComponent(() => Comp);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load canvas');
      });
    return () => { cancelled = true; };
  }, [compiledJs]);

  if (compileError) {
    return (
      <Box sx={{ p: 2, border: `1px solid ${colors.accent.red}`, borderRadius: 1, bgcolor: colors.bg.tertiary }}>
        <Typography sx={{ color: colors.accent.red, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", mb: 1 }}>
          Canvas compile error
        </Typography>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.68rem', whiteSpace: 'pre-wrap' }}>{compileError}</Typography>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Typography sx={{ color: colors.accent.red, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" }}>
        {loadError}
      </Typography>
    );
  }

  if (!compiledJs || !Component) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  const Live = Component;
  return (
    <CanvasRuntimeBoundary>
      <Live />
    </CanvasRuntimeBoundary>
  );
}
