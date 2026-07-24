/**
 * Document Studio — dense PDF table grid extraction (Phase 3).
 *
 * The layout analyzer's `enhancePdfLocators` only locates variables that already
 * have a `sampleValue`/`sample_text` locator (blanks or explicit samples). A
 * fully-filled document (e.g. a tax forecast) has NO blanks — every cell holds
 * real data — so fill_clone receives zero overlay targets and the clone fails.
 *
 * This module infers a regular grid table from the raw pdfjs text items: it
 * clusters items into rows by y-coordinate and into columns by x-coordinate,
 * identifies the row-label column (left) and column-header row (top), and emits
 * one `pdf_region` Variable per data cell keyed by `<row_label>__<col_header>`.
 * Each variable carries the cell's existing value as `sampleValue` and a
 * `pdf_region` locator at the cell's (page, x, y, width, fontSize), so fill_clone
 * can cover the old value and draw the new (derived) value at the exact spot.
 *
 * The algorithm is deterministic (no model) and works best for fixed-grid
 * financial forms: regular column alignment, one row label per row, numeric
 * data cells. Irregular tables fall through to the vision-produced LayoutMap.
 */

import { extractPdfTextItems, type TextItemLoc } from '../../templates/pdf-fill.js';
import type { Variable } from '../types.js';

export interface PdfGridCell {
  page: number;
  rowLabel: string;
  colHeader: string;
  rowIndex: number; // 0-based data row index (excludes header row)
  colIndex: number; // 0-based data col index (excludes label column)
  text: string; // existing cell value
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PdfGridTable {
  page: number;
  rowLabels: string[];
  colHeaders: string[];
  cells: PdfGridCell[]; // (rowLabels.length * colHeaders.length) entries, row-major
  /** Bounding box of the table in PDF points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractGridsOptions {
  /** Tolerance in PDF points for grouping text items into the same row (y). Default 4. */
  rowTolerancePt?: number;
  /** Tolerance in PDF points for grouping text items into the same column (x). Default 20. */
  colTolerancePt?: number;
  /** Min rows (incl. header) for a cluster to count as a table. Default 4. */
  minRows?: number;
  /** Min cols (incl. label col) for a cluster to count as a table. Default 3. */
  minCols?: number;
  /** Max fraction of cells allowed to be empty for a valid grid. Default 0.5. */
  maxEmptyFraction?: number;
}

/** Extract one or more regular grid tables from a PDF buffer. */
export async function extractPdfGridTables(
  buffer: Buffer,
  opts: ExtractGridsOptions = {},
): Promise<{ tables: PdfGridTable[]; warnings: string[] }> {
  const rowTol = opts.rowTolerancePt ?? 4;
  const colTol = opts.colTolerancePt ?? 20;
  const minRows = opts.minRows ?? 4;
  const minCols = opts.minCols ?? 3;
  const maxEmptyFraction = opts.maxEmptyFraction ?? 0.5;
  const warnings: string[] = [];

  let items: TextItemLoc[];
  try {
    items = await extractPdfTextItems(buffer);
  } catch (err) {
    warnings.push(`pdf-grid: text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return { tables: [], warnings };
  }
  if (items.length === 0) return { tables: [], warnings };

  // Group items by page, then detect a grid per page (most forms are single-page).
  const byPage = new Map<number, TextItemLoc[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const arr = byPage.get(it.page) ?? [];
    arr.push(it);
    byPage.set(it.page, arr);
  }

  const tables: PdfGridTable[] = [];
  for (const [page, pageItems] of byPage) {
    const grid = detectGridOnPage(pageItems, page, { rowTol, colTol, minRows, minCols, maxEmptyFraction });
    if (grid) tables.push(grid);
  }
  return { tables, warnings };
}

interface DetectOpts {
  rowTol: number;
  colTol: number;
  minRows: number;
  minCols: number;
  maxEmptyFraction: number;
}

/**
 * Detect a single dominant grid table on a page. Strategy:
 *  1. Cluster items into rows by y (items with |y - y0| <= rowTol share a row).
 *  2. Classify each row as DATA (>= 50% of non-leftmost items are numeric) or
 *     HEADER/PROSE (mostly text). Data rows are the table body.
 *  3. Find the HEADER row: the non-data row immediately above the topmost data
 *    row that has >= minCols items. Use its item x-positions as COLUMN CENTERS
 *    (header text has one stable item per column, unlike right-aligned numeric
 *    data whose left-x varies by digit count).
 *  4. Keep only data rows that populate >= 70% of the header columns (dominant
 *    grid). Rows from other sub-tables with different column structure drop out.
 *  5. Leftmost column = row labels; emit one cell per (data row, data col).
 */
function detectGridOnPage(items: TextItemLoc[], page: number, o: DetectOpts): PdfGridTable | null {
  if (items.length < o.minRows * o.minCols) return null;

  // 1. Cluster into rows by y (descending y = top to bottom).
  const rowClusters = clusterByCoord(items, (it) => it.y, o.rowTol);
  rowClusters.sort((a, b) => b[0]!.y - a[0]!.y);

  // 2. Classify rows as data vs non-data by numeric content fraction.
  const rowClasses = rowClusters.map((row) => classifyRow(row));
  const dataRowIdx = rowClasses
    .map((c, i) => ({ c, i }))
    .filter((e) => e.c.isData)
    .map((e) => e.i);
  if (dataRowIdx.length < o.minRows - 1) return null;

  const dataRows = dataRowIdx.map((i) => rowClusters[i]!);
  const topDataIdx = dataRowIdx[0]!; // index in rowClusters of the topmost data row
  const topDataY = dataRows[0]![0]!.y;

  // 3. Find the header row: nearest non-data row ABOVE the topmost data row
  //    (scanning upward from the data row, not from the top of the page) with
  //    enough items. This skips titles/letterhead and finds the column-header row.
  let headerRow: TextItemLoc[] | null = null;
  for (let i = topDataIdx - 1; i >= 0; i--) {
    const row = rowClusters[i]!;
    if (row[0]!.y <= topDataY) break; // below data (shouldn't happen, safety)
    if (rowClasses[i]!.isData) continue;
    if (row.filter((it) => it.str.trim()).length >= o.minCols) { headerRow = row; break; }
  }

  // Column centers: prefer header item positions (stable, one per column).
  // Fallback: cluster data-row x by right-edge (right-aligned numerics share right edge).
  let colCenters: number[];
  let colHeaders: string[];
  if (headerRow) {
    const headerItems = headerRow.filter((it) => it.str.trim()).sort((a, b) => a.x - b.x);
    colCenters = headerItems.map((it) => it.x);
    colHeaders = headerItems.map((it) => it.str.trim().slice(0, 24));
  } else {
    // No header found: cluster by right-edge x of data items.
    const allRightX = dataRows.flatMap((r) => r.map((it) => it.x + (it.width || 0)));
    colCenters = clusterCenters(allRightX, o.colTol);
    colHeaders = colCenters.map((_, i) => `col${i}`);
  }
  if (colCenters.length < o.minCols) return null;

  // 4. Keep data rows that populate >= 70% of columns (dominant grid).
  const minColsForRow = Math.max(o.minCols, Math.floor(colCenters.length * 0.7));
  const dominantDataRows = dataRows.filter((row) => {
    const cols = new Set<number>();
    for (const it of row) {
      const ci = nearestIndex(colCenters, it.x);
      if (ci !== -1) cols.add(ci);
    }
    return cols.size >= minColsForRow;
  });
  if (dominantDataRows.length < o.minRows - 1) return null;

  const labelColIdx = 0;
  const dataColIdx = colCenters.slice(1).map((_, i) => i + 1);
  if (dataColIdx.length < 2) return null;

  // 5. Emit cells from dominant data rows.
  const cells: PdfGridCell[] = [];
  let empty = 0;
  const rowLabels: string[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let ri = 0; ri < dominantDataRows.length; ri++) {
    const row = dominantDataRows[ri]!;
    const labelHits = row.filter((it) => nearestIndex(colCenters, it.x) === labelColIdx);
    const rowLabel = labelHits.map((it) => it.str.trim()).filter(Boolean).join(' ').slice(0, 24) || `row${ri}`;
    rowLabels.push(rowLabel);

    for (let dj = 0; dj < dataColIdx.length; dj++) {
      const ci = dataColIdx[dj]!;
      const cx = colCenters[ci]!;
      const hits = row.filter((it) => nearestIndex(colCenters, it.x) === ci);
      const text = hits.map((it) => it.str.trim()).filter(Boolean).join(' ');
      if (!text) { empty++; continue; }
      const first = hits[0]!;
      const nextBoundary = ci + 1 < colCenters.length ? colCenters[ci + 1]! : first.x + (first.width || 60);
      const cellWidth = Math.max(first.width || 40, nextBoundary - cx - 2);
      cells.push({
        page,
        rowLabel,
        colHeader: colHeaders[ci] ?? `col${ci}`,
        rowIndex: ri,
        colIndex: dj,
        text,
        x: first.x,
        y: first.y,
        width: cellWidth,
        height: first.height || 10,
        fontSize: Math.max(8, Math.min(14, first.height || 10)),
      });
      minX = Math.min(minX, first.x);
      maxX = Math.max(maxX, first.x + cellWidth);
      minY = Math.min(minY, first.y);
      maxY = Math.max(maxY, first.y + (first.height || 10));
    }
  }

  const totalCells = dominantDataRows.length * dataColIdx.length;
  if (totalCells === 0) return null;
  if (empty / totalCells > o.maxEmptyFraction) return null;

  return {
    page,
    rowLabels,
    colHeaders,
    cells,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Classify a row as data (mostly numeric) or header/prose (mostly text). */
function classifyRow(row: TextItemLoc[]): { isData: boolean } {
  const nonEmpty = row.filter((it) => it.str.trim());
  if (nonEmpty.length < 2) return { isData: false };
  const afterLabel = nonEmpty.slice(1);
  if (afterLabel.length === 0) return { isData: false };
  const numAfterLabel = afterLabel.filter((it) => isNumericCell(it.str)).length;
  return { isData: numAfterLabel / afterLabel.length >= 0.5 };
}

function isNumericCell(s: string): boolean {
  const cleaned = s.replace(/[,\s]/g, '').replace(/[()]/g, '');
  return cleaned !== '' && /^-?[\d.]+%?$/.test(cleaned);
}

/** Cluster items by a scalar coordinate within tolerance; returns arrays of items. */
function clusterByCoord<T>(items: T[], coord: (t: T) => number, tol: number): T[][] {
  const sorted = [...items].sort((a, b) => coord(b) - coord(a));
  const clusters: T[][] = [];
  for (const it of sorted) {
    const c = coord(it);
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(c - coord(last[0]!)) <= tol) {
      last.push(it);
    } else {
      clusters.push([it]);
    }
  }
  return clusters;
}

/** 1D clustering of numeric values into representative centers (ascending). */
function clusterCenters(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];
  let bucket: number[] = [];
  for (const v of sorted) {
    if (bucket.length === 0 || Math.abs(v - bucket[0]!) <= tol) {
      bucket.push(v);
    } else {
      centers.push(avg(bucket));
      bucket = [v];
    }
  }
  if (bucket.length > 0) centers.push(avg(bucket));
  return centers;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function nearestIndex(centers: number[], v: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(centers[i]! - v);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/**
 * Convert detected grid tables into fill_clone Variables. One Variable per data
 * cell, keyed `<row_label>__<col_header>` (snake-cased). Each carries the cell's
 * existing text as `sampleValue` and a `pdf_region` locator, so fill_clone can
 * cover the old value and draw the derived value at the exact coordinates.
 */
export function gridTablesToVariables(tables: PdfGridTable[]): Variable[] {
  const vars: Variable[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    for (const cell of table.cells) {
      const key = `${snake(cell.rowLabel)}__${snake(cell.colHeader)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isNumeric = /^[\d,.\s+-]+$/.test(cell.text.replace(/[^0-9,.\s+-]/g, ''));
      vars.push({
        key,
        label: `${cell.rowLabel} — ${cell.colHeader}`,
        datatype: isNumeric ? 'money' : 'string',
        required: false,
        askPolicy: 'derive',
        locator: {
          type: 'pdf_region',
          page: cell.page,
          x: cell.x,
          y: cell.y,
          width: cell.width,
          height: cell.height,
          fontSize: cell.fontSize,
        },
        sensitivity: 'financial',
        sampleValue: cell.text,
        description: `Cell at row "${cell.rowLabel}", column "${cell.colHeader}" (current value: ${cell.text}). Replace with the derived/forecast value.`,
      });
    }
  }
  return vars;
}

function snake(v: string): string {
  return v.trim().toLowerCase().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * End-to-end: extract grids from a PDF buffer and return the fill_clone
 * Variables for every detected data cell. The primary entry point used by
 * analyzeMaster to augment a layout master's variable set for filled documents.
 */
export async function extractPdfGridVariables(
  buffer: Buffer,
  opts: ExtractGridsOptions = {},
): Promise<{ variables: Variable[]; tables: PdfGridTable[]; warnings: string[] }> {
  const { tables, warnings } = await extractPdfGridTables(buffer, opts);
  return { variables: gridTablesToVariables(tables), tables, warnings };
}
