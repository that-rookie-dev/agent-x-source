import { useCallback, useEffect, useMemo, useState } from 'react';

export interface VirtualGridOptions {
  itemCount: number;
  /** Estimated card height including gap contribution. */
  rowHeight: number;
  minColWidth: number;
  gap: number;
  overscanRows?: number;
  enabled?: boolean;
  threshold?: number;
}

/**
 * Lightweight CSS-grid virtualization without extra deps.
 * Renders only rows intersecting the scroll viewport (+ overscan).
 */
export function useVirtualGrid(
  containerRef: React.RefObject<HTMLElement | null>,
  opts: VirtualGridOptions,
) {
  const {
    itemCount,
    rowHeight,
    minColWidth,
    gap,
    overscanRows = 2,
    enabled = true,
    threshold = 24,
  } = opts;

  const [metrics, setMetrics] = useState({ cols: 1, start: 0, end: itemCount });

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el || !enabled || itemCount < threshold) {
      setMetrics((prev) =>
        prev.start === 0 && prev.end === itemCount && prev.cols === 1
          ? prev
          : { cols: 1, start: 0, end: itemCount },
      );
      return;
    }

    const width = el.clientWidth;
    const cols = Math.max(1, Math.floor((width + gap) / (minColWidth + gap)));
    const rowCount = Math.ceil(itemCount / cols);
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
    const visibleRows = Math.ceil(viewHeight / rowHeight) + overscanRows * 2;
    const endRow = Math.min(rowCount, startRow + visibleRows);
    const start = startRow * cols;
    const end = Math.min(itemCount, endRow * cols);
    setMetrics((prev) =>
      prev.cols === cols && prev.start === start && prev.end === end
        ? prev
        : { cols, start, end },
    );
  }, [containerRef, enabled, gap, itemCount, minColWidth, overscanRows, rowHeight, threshold]);

  useEffect(() => {
    recompute();
  }, [itemCount, recompute]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => recompute();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => recompute()) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [containerRef, recompute]);

  const virtualized = enabled && itemCount >= threshold;
  const visibleIndices = useMemo(() => {
    if (!virtualized) {
      return Array.from({ length: itemCount }, (_, i) => i);
    }
    const out: number[] = [];
    for (let i = metrics.start; i < metrics.end; i++) out.push(i);
    return out;
  }, [itemCount, metrics.end, metrics.start, virtualized]);

  const topSpacerPx = virtualized ? Math.floor(metrics.start / Math.max(1, metrics.cols)) * rowHeight : 0;
  const bottomRows = virtualized
    ? Math.ceil(itemCount / Math.max(1, metrics.cols)) - Math.ceil(metrics.end / Math.max(1, metrics.cols))
    : 0;
  const bottomSpacerPx = Math.max(0, bottomRows * rowHeight);

  return {
    virtualized,
    visibleIndices,
    topSpacerPx,
    bottomSpacerPx,
    cols: metrics.cols,
  };
}
