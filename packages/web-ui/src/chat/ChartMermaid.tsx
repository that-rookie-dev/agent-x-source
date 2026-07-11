import { useEffect, useId, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { CODE_BLOCK_TOKENS } from './code-block-chrome';

let mermaidReady: Promise<typeof import('mermaid')> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then(async (m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'JetBrains Mono, monospace',
        flowchart: { htmlLabels: false },
      });
      return m;
    });
  }
  return mermaidReady;
}

export function ChartMermaid({ source, height }: { source: string; height: number }) {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    loadMermaid()
      .then(async (m) => {
        const id = `mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: out } = await m.default.render(id, source);
        if (!cancelled) setSvg(out);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'mermaid-failed');
      });
    return () => { cancelled = true; };
  }, [source, reactId]);

  if (error) {
    return (
      <Typography sx={{ color: colors.text.tertiary, fontSize: CODE_BLOCK_TOKENS.sansFontSize, fontFamily: "'JetBrains Mono', monospace" }}>
        Diagram unavailable ({error.slice(0, 80)})
      </Typography>
    );
  }

  if (!svg) {
    return (
      <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.text.dim, fontSize: CODE_BLOCK_TOKENS.sansFontSize }}>
        Rendering diagram…
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height,
        overflow: 'auto',
        '& svg': { maxWidth: '100%', height: 'auto' },
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
