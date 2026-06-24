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

export {
  MEDICAL_INFORMATIONAL_DISCLAIMER,
  MEDICAL_HUB_CATEGORY_IDS,
  MEDICAL_HUB_CATALOG_IDS,
  isMedicalHubCategory,
  isMedicalHubCatalogId,
  crewRequiresMedicalDisclaimer,
} from './constants/medical-hub.js';

export type {
  CrewMatchCandidate,
  CrewSuggestionEvaluation,
} from './types/crew-catalog.js';
