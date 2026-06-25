export type CatalogSeedStatus = 'idle' | 'seeding' | 'ready' | 'error';

export interface CatalogSeedSnapshot {
  status: CatalogSeedStatus;
  /** Hub catalog table populated by the manifest (not the user `crews` roster). */
  table: 'crew_catalog';
  ftsTable: 'crew_catalog_fts' | 'crew_catalog.search_tsv';
  seededCount: number;
  expectedCount: number;
  manifestRevision: number;
  storedRevision: number;
  percent: number;
  processedInRun: number;
  error?: string;
}

interface LiveSeedState {
  status: CatalogSeedStatus;
  expectedCount: number;
  manifestRevision: number;
  processedInRun: number;
  error?: string;
}

const live: LiveSeedState = {
  status: 'idle',
  expectedCount: 0,
  manifestRevision: 0,
  processedInRun: 0,
};

let inflight: Promise<void> | null = null;

export function setCatalogSeedInflight(promise: Promise<void> | null): void {
  inflight = promise;
}

export function getCatalogSeedInflight(): Promise<void> | null {
  return inflight;
}

export function markCatalogSeedStarted(expectedCount: number, manifestRevision: number): void {
  live.status = 'seeding';
  live.expectedCount = expectedCount;
  live.manifestRevision = manifestRevision;
  live.processedInRun = 0;
  live.error = undefined;
}

export function markCatalogSeedProgress(processed: number, total: number): void {
  live.status = 'seeding';
  live.processedInRun = processed;
  live.expectedCount = total;
}

export function markCatalogSeedReady(expectedCount: number, manifestRevision: number): void {
  live.status = 'ready';
  live.expectedCount = expectedCount;
  live.manifestRevision = manifestRevision;
  live.processedInRun = expectedCount;
  live.error = undefined;
}

export function markCatalogSeedIdle(): void {
  live.status = 'idle';
  live.processedInRun = 0;
  live.error = undefined;
}

export function markCatalogSeedError(message: string): void {
  live.status = 'error';
  live.error = message;
}

export function buildCatalogSeedSnapshot(input: {
  seededCount: number;
  expectedCount: number;
  manifestRevision: number;
  storedRevision: number;
  ftsBackend: CatalogSeedSnapshot['ftsTable'];
}): CatalogSeedSnapshot {
  const { seededCount, expectedCount, manifestRevision, storedRevision, ftsBackend } = input;
  let status: CatalogSeedStatus = live.status;
  if (status === 'seeding') {
    // keep seeding
  } else if (expectedCount > 0 && seededCount >= expectedCount && storedRevision >= manifestRevision) {
    status = 'ready';
  } else if (live.status === 'error') {
    status = 'error';
  } else if (expectedCount === 0) {
    status = 'idle';
  } else if (seededCount < expectedCount || storedRevision < manifestRevision) {
    status = status === 'idle' ? 'idle' : status;
  }

  const progressBase = status === 'seeding' && live.processedInRun > 0
    ? live.processedInRun
    : seededCount;
  const percent = expectedCount > 0
    ? Math.min(100, Math.round((progressBase / expectedCount) * 100))
    : seededCount > 0 ? 100 : 0;

  return {
    status,
    table: 'crew_catalog',
    ftsTable: ftsBackend,
    seededCount,
    expectedCount,
    manifestRevision,
    storedRevision,
    percent,
    processedInRun: live.processedInRun,
    error: live.error,
  };
}
