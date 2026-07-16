import {
  formatHostCrewIdentity,
  type HostCrewIdentityInput,
} from '@agentx/shared';

/**
 * Normalize session field names so callers can use either legacy (tokensUsed)
 * or Postgres/StorableSession (tokenUsed) conventions interchangeably.
 */
export function normalizeSessionUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...updates };
  if (normalized['tokensUsed'] != null && normalized['tokenUsed'] == null) {
    normalized['tokenUsed'] = normalized['tokensUsed'];
  }
  if (normalized['tokenUsed'] != null && normalized['tokensUsed'] == null) {
    normalized['tokensUsed'] = normalized['tokenUsed'];
  }
  return normalized;
}

export type { SessionListKpis } from '@agentx/shared';
export { EMPTY_SESSION_KPIS } from '@agentx/shared';

export type HostCrewSnapshotSource = HostCrewIdentityInput & {
  id: string;
  color?: string;
  catalogId?: string;
};

export function hostCrewSnapshotFromInput(crew: HostCrewSnapshotSource): {
  hostCrewName: string;
  hostCrewCallsign: string;
  hostCrewTitle?: string | null;
  hostCrewColor?: string | null;
  hostCrewCatalogId?: string | null;
  hostCrewCategoryId?: string | null;
} {
  const formatted = formatHostCrewIdentity(crew);
  return {
    hostCrewName: formatted.name,
    hostCrewCallsign: formatted.callsign,
    hostCrewTitle: crew.title ?? null,
    hostCrewColor: crew.color ?? null,
    hostCrewCatalogId: crew.catalogId ?? (crew.id.startsWith('hub-') ? crew.id : null),
    hostCrewCategoryId: crew.categoryId ?? null,
  };
}

export function callsignFromHostCrewId(hostCrewId?: string | null): string | null {
  if (!hostCrewId?.startsWith('hub-')) return null;
  const callsign = hostCrewId.slice(4);
  return callsign || null;
}

function sessionTitleShouldFollowHostName(
  existing: { title?: string | null; hostCrewName?: string | null },
  crew: HostCrewSnapshotSource,
  formattedName: string,
): boolean {
  const title = existing.title?.trim();
  if (!title) return true;
  const priorHost = existing.hostCrewName?.trim();
  if (priorHost && title === priorHost) return true;
  if (title === crew.name.trim()) return true;
  if (title === formattedName) return false;
  return false;
}

/** Fill missing snapshot fields and upgrade legacy names/callsigns to Dr. honorific when qualified. */
export function hostCrewSnapshotPatch(
  existing: {
    title?: string | null;
    hostCrewName?: string | null;
    hostCrewCallsign?: string | null;
    hostCrewTitle?: string | null;
    hostCrewColor?: string | null;
    hostCrewCatalogId?: string | null;
    hostCrewCategoryId?: string | null;
  },
  crew: HostCrewSnapshotSource,
): Record<string, string | null> {
  const snap = hostCrewSnapshotFromInput(crew);
  const patch: Record<string, string | null> = {};

  if (!existing.hostCrewName && snap.hostCrewName) patch.hostCrewName = snap.hostCrewName;
  else if (snap.hostCrewName && existing.hostCrewName !== snap.hostCrewName) {
    patch.hostCrewName = snap.hostCrewName;
  }

  if (!existing.hostCrewCallsign && snap.hostCrewCallsign) patch.hostCrewCallsign = snap.hostCrewCallsign;
  else if (snap.hostCrewCallsign && existing.hostCrewCallsign !== snap.hostCrewCallsign) {
    patch.hostCrewCallsign = snap.hostCrewCallsign;
  }

  if (!existing.hostCrewTitle && snap.hostCrewTitle) patch.hostCrewTitle = snap.hostCrewTitle;
  if (!existing.hostCrewColor && snap.hostCrewColor) patch.hostCrewColor = snap.hostCrewColor;
  if (!existing.hostCrewCatalogId && snap.hostCrewCatalogId) patch.hostCrewCatalogId = snap.hostCrewCatalogId;
  if (!existing.hostCrewCategoryId && snap.hostCrewCategoryId) patch.hostCrewCategoryId = snap.hostCrewCategoryId;

  const nextHostName = patch.hostCrewName ?? existing.hostCrewName ?? snap.hostCrewName;
  if (nextHostName && sessionTitleShouldFollowHostName(existing, crew, nextHostName)) {
    if (existing.title !== nextHostName) patch.title = nextHostName;
  }

  return patch;
}
