/**
 * DeterministicId — stable content-addressed IDs for memory nodes.
 *
 * Nodes get deterministic IDs based on (normalized label + content hash
 * + source provenance). This means re-ingesting the same text produces the same
 * node IDs, enabling idempotent ingestion and cross-session merge.
 *
 * Node IDs are deterministic UUIDs (SHA-1 name-based, RFC 4122 v5 layout) so
 * they are valid values for the `memory_nodes.id UUID` column while remaining
 * content-addressed.
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 5 (deterministic ID assignment).
 */
import { createHash } from 'node:crypto';

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

/** Derive a deterministic RFC 4122 v5-style UUID from an arbitrary key string. */
function deterministicUuid(key: string): string {
  const digest = createHash('sha1').update(`agentx-memory-node|${key}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  return deterministicUuid(key);
}

/**
 * Generate a deterministic edge ID from source + target + relationship type.
 * This prevents duplicate edges on re-ingestion. Edge IDs are logical keys
 * used for pre-persist graph assembly only — the database assigns its own
 * primary keys and dedupes on (source, target, relationship_type).
 */
export function deterministicEdgeId(
  sourceNodeId: string,
  targetNodeId: string,
  relationshipType: string,
): string {
  const key = `${sourceNodeId}|${targetNodeId}|${relationshipType}`;
  return `me_${fnv1a(key).toString(16).padStart(8, '0')}`;
}
