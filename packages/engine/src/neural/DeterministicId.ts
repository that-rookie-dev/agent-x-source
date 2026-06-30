/**
 * DeterministicId — stable content-addressed IDs for memory nodes.
 *
 * Nodes get deterministic IDs based on (normalized label + content hash
 * + source provenance). This means re-ingesting the same text produces the same
 * node IDs, enabling idempotent ingestion and cross-session merge.
 *
 * The ID format is `mn_<hex>` (memory node), NOT a UUID. This is a deliberate
 * content-addressed key, not a random identifier.
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 5 (deterministic ID assignment).
 */

/** FNV-1a 32-bit hash. */
function fnv1a(data: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Normalize a label for stable hashing (lowercase, strip punctuation, collapse spaces). */
export function normalizeForHash(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a deterministic memory node ID from label + content + provenance.
 *
 * The key components are:
 * - Normalized label (case-insensitive, punctuation-stripped)
 * - Content hash (first 200 chars, normalized)
 * - Source ID (document or session)
 *
 * Re-ingesting the same text with the same source produces the same ID.
 */
export function deterministicNodeId(
  label: string,
  content: string,
  sourceId?: string,
): string {
  const normalizedLabel = normalizeForHash(label);
  const normalizedContent = normalizeForHash(content.slice(0, 200));
  const ns = sourceId ?? 'global';
  const key = `${ns}|${normalizedLabel}|${normalizedContent}`;
  return `mn_${fnv1a(key).toString(16).padStart(8, '0')}`;
}

/**
 * Generate a deterministic edge ID from source + target + relationship type.
 * This prevents duplicate edges on re-ingestion.
 */
export function deterministicEdgeId(
  sourceNodeId: string,
  targetNodeId: string,
  relationshipType: string,
): string {
  const key = `${sourceNodeId}|${targetNodeId}|${relationshipType}`;
  return `me_${fnv1a(key).toString(16).padStart(8, '0')}`;
}
