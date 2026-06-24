/** Browser-safe exports (no Node.js fs/os/crypto). */
export {
  normalizeMessageForUi,
  rebuildPartsFromCanonical,
  shouldRebuildStoredParts,
  partsCorruptedByCrossTurn,
  partsToolIdsMismatch,
  partsTextExceedsContent,
  dedupeToolParts,
  buildPartsFromDbRows,
  assignPartsToAssistantMessage,
  buildPartsForPersist,
} from './utils/message-parts.js';

export type { MessagePart, PersistedToolCall } from './utils/message-parts.js';
