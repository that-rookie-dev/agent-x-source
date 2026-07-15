import { Component, lazy, Suspense, memo, useMemo, useRef, useState, type ErrorInfo, type ReactNode, type RefObject } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import {
  parseChartSpec,
  chartBlockTitle,
  resolveChartHeight,
  isMermaidSource,
  isIncompleteChartJson,
  mermaidSpecFromSource,
  type ChartSpec,
} from '@agentx/shared/browser';
import { colors } from '../theme';
import { CodeBlockChrome, CodeBlockBody, CODE_BLOCK_TOKENS } from './code-block-chrome';
import { downloadBlob, downloadText, findChartSvg, serializeSvg, svgToPngBlob } from './chart-export';

const ChartRenderer = lazy(() =>
  import('./ChartRenderer').then((m) => ({ default: m.ChartRenderer })),
);
const ChartMermaid = lazy(() =>
  import('./ChartMermaid').then((m) => ({ default: m.ChartMermaid })),
);

function ChartFallback({ height, label = 'Loading chart…' }: { height: number; label?: string }) {
  return (
    <Box sx={{
      height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: colors.text.dim,
      fontSize: CODE_BLOCK_TOKENS.sansFontSize,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {label}
    </Box>
  );
}

function ChartError({ message }: { message: string }) {
  return (
    <Typography sx={{
      m: 0,
      color: colors.text.tertiary,
      fontSize: CODE_BLOCK_TOKENS.sansFontSize,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      Chart unavailable ({message})
    </Typography>
  );
}

class ChartErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(err: Error): { error: string } {
    return { error: err.message || 'render-failed' };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    if (typeof console !== 'undefined') {
      console.warn('[ChartBlock]', err.message, info.componentStack);
    }
  }

  override render(): ReactNode {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

function ExportButtons({ rootRef, basename }: { rootRef: RefObject<HTMLDivElement | null>; basename: string }) {
  const [busy, setBusy] = useState(false);
  const onSvg = () => {
    const svg = findChartSvg(rootRef.current);
    if (!svg) return;
    downloadText(serializeSvg(svg), `${basename}.svg`);
  };
  const onPng = async () => {
    const svg = findChartSvg(rootRef.current);
    if (!svg) return;
    setBusy(true);
    try {
      const blob = await svgToPngBlob(svg);
      downloadBlob(blob, `${basename}.png`);
    } catch { /* best-effort */ }
    setBusy(false);
  };
  return (
    <Box sx={{ display: 'flex', gap: 0.25 }}>
      <Tooltip title="Download SVG" arrow>
        <IconButton size="small" onClick={onSvg} sx={{ color: colors.text.dim, p: 0.25, fontSize: '0.58rem', borderRadius: 0.5 }}>
          SVG
        </IconButton>
      </Tooltip>
      <Tooltip title="Download PNG" arrow>
        <IconButton size="small" disabled={busy} onClick={() => { void onPng(); }} sx={{ color: colors.text.dim, p: 0.25, fontSize: '0.58rem', borderRadius: 0.5 }}>
          PNG
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function resolveSpec(code: string, language?: string):
  | { ok: true; spec: ChartSpec; copyText: string }
  | { ok: false; error: string; copyText: string; pending?: boolean } {
  const lang = (language || '').toLowerCase();
  const chartLang = lang === 'chart' || lang === 'graph' || lang === 'viz';

  if (lang === 'mermaid' || (!chartLang && isMermaidSource(code))) {
    const mermaidType = lang === 'sequence' || lang === 'state' || lang === 'er' || lang === 'mindmap' || lang === 'org'
      ? lang
      : 'mermaid';
    return { ok: true, spec: mermaidSpecFromSource(code, mermaidType), copyText: code };
  }

  if (chartLang && isIncompleteChartJson(code)) {
    return { ok: false, error: 'building', copyText: code, pending: true };
  }

  const parsed = parseChartSpec(code);
  if (!parsed.ok) {
    // ```graph / ```viz sometimes carry Mermaid source — fall back instead of hard-failing.
    if (isMermaidSource(code)) {
      return { ok: true, spec: mermaidSpecFromSource(code, 'mermaid'), copyText: code };
    }
    return { ok: false, error: parsed.error, copyText: code };
  }
  return { ok: true, spec: parsed.spec, copyText: JSON.stringify(parsed.spec, null, 2) };
}

export const ChartBlock = memo(function ChartBlock({ code, language }: { code: string; language?: string }) {
  const resolved = useMemo(() => resolveSpec(code, language), [code, language]);
  const rootRef = useRef<HTMLDivElement>(null);

  if (!resolved.ok) {
    if (resolved.pending) {
      return (
        <CodeBlockChrome title="Chart" copyText={resolved.copyText}>
          <CodeBlockBody>
            <ChartFallback height={120} label="Building chart…" />
          </CodeBlockBody>
        </CodeBlockChrome>
      );
    }
    return (
      <CodeBlockChrome title="Chart" copyText={resolved.copyText}>
        <CodeBlockBody>
          <ChartError message={resolved.error} />
        </CodeBlockBody>
      </CodeBlockChrome>
    );
  }

  const spec = resolved.spec;
  const height = resolveChartHeight(spec);
  const title = chartBlockTitle(spec);
  const isMermaid = Boolean(spec.mermaid?.trim())
    || ['mermaid', 'sequence', 'state', 'er', 'mindmap', 'org'].includes(spec.type);
  const basename = (title || 'chart').replace(/[^\w.-]+/g, '_').slice(0, 40);

  return (
    <CodeBlockChrome title={title} copyText={resolved.copyText}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1, pt: 0.5 }}>
        <ExportButtons rootRef={rootRef} basename={basename} />
      </Box>
      <CodeBlockBody sx={{ px: 1, py: 0.75 }}>
        {spec.subtitle && (
          <Typography sx={{ mb: 0.5, fontSize: '0.62rem', color: colors.text.dim, fontFamily: "'Inter', sans-serif" }}>
            {spec.subtitle}{spec.unit ? ` · ${spec.unit}` : ''}
          </Typography>
        )}
        {!spec.subtitle && spec.unit && (
          <Typography sx={{ mb: 0.5, fontSize: '0.62rem', color: colors.text.dim, fontFamily: "'Inter', sans-serif" }}>
            {spec.unit}
          </Typography>
        )}
        <Box ref={rootRef}>
          <ChartErrorBoundary key={`${language ?? ''}:${code.length}:${title}`} fallback={<ChartError message="render-failed" />}>
            <Suspense fallback={<ChartFallback height={height} />}>
              {isMermaid && spec.mermaid ? (
                <ChartMermaid source={spec.mermaid} height={height} />
              ) : isMermaid ? (
                <ChartError message="mermaid-required" />
              ) : (
                <ChartRenderer spec={spec} height={height} />
              )}
            </Suspense>
          </ChartErrorBoundary>
        </Box>
      </CodeBlockBody>
    </CodeBlockChrome>
  );
});
