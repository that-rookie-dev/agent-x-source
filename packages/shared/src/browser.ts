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
  upsertDeepSearchPart,
  attachDeepSearchPartsFromTools,
  partitionPartsForRender,
  orderPartsForChatRender,
  parseDeepSearchProgressFromStream,
  parseDeepSearchProgressLine,
  deepSearchBundleFromMetadata,
} from './utils/deep-search-parts.js';
export type { DeepSearchPartPayload } from './utils/deep-search-parts.js';

export {
  MEDICAL_INFORMATIONAL_DISCLAIMER,
  MEDICAL_HUB_CATEGORY_IDS,
  MEDICAL_HUB_CATALOG_IDS,
  isMedicalHubCategory,
  isMedicalHubCatalogId,
  crewRequiresMedicalDisclaimer,
} from './constants/medical-hub.js';

export {
  formatCrewDisplayName,
  formatCrewDisplayCallsign,
  crewQualifiesForDrHonorific,
  formatHostCrewIdentity,
  drHonorificInputFromHostCrew,
  isScienceHubCategory,
} from './constants/doctorate-honorific.js';

export type { DrHonorificInput, HostCrewIdentityInput } from './constants/doctorate-honorific.js';

export type {
  CrewMatchCandidate,
  CrewSuggestionEvaluation,
} from './types/crew-catalog.js';

export type {
  QuestionnairePayload,
  QuestionnaireQuestion,
  QuestionnaireQuestionType,
  QuestionnaireOption,
  QuestionnaireRecord,
  QuestionnaireAnswerValue,
  QuestionnaireResponseState,
} from './types/questionnaire.js';

export type { ClarificationField, ClarificationSource } from './types/events.js';

export type {
  NotificationChannelsConfig,
  NotificationChannelId,
  TelegramChannelConfig,
  SlackChannelConfig,
  EmailChannelConfig,
  DiscordChannelConfig,
  TelegramDiscoveredChat,
} from './types/channels.js';

export {
  MAX_QUESTIONNAIRE_CHOICES,
  QUESTIONNAIRE_CUSTOM_SUFFIX,
  normalizeAskClarificationArgs,
  legacyClarificationToQuestionnaire,
  initialQuestionnaireState,
  formatQuestionnaireAnswers,
  canSubmitQuestionnaire,
  buildTextQuestionnaire,
  collectAnsweredQuestionnaireTexts,
  hydrateMessageHistoryEntries,
  coerceQuestionnaireOptionText,
  sanitizeQuestionnairePayload,
} from './utils/questionnaire.js';

export type {
  TurnFeedbackRating,
  TurnFeedbackRecord,
  TurnFeedbackEligibilityInput,
} from './types/turn-feedback.js';

export {
  isTurnFeedbackEligible,
  summarizeTurnForFeedback,
  buildTurnFeedbackContext,
} from './utils/turn-feedback.js';

export { summarizeMessageForTurnFeedback, displayTextForTurnFeedback } from './utils/turn-display.js';
export { sanitizeAutomationNotificationBody } from './utils/notification-body.js';

export { explicitCrewRequest, prefersCrewRosterFirst, isWorkforceOrSpecialistNeed } from './utils/crew-roster-intent.js';

export {
  NEURAL_BRAIN_MIN_RAM_GB,
  STYLETTS2_MIN_RAM_GB,
  LOCAL_MODEL_MIN_RAM_GB,
  VOICE_WARMUP_MIN_RAM_GB,
  getSystemMemoryGB,
  isNeuralBrainSupported,
  isStyleTtsSupported,
  isLocalModelSupported,
  isVoiceWarmupSupported,
  buildPublicSystemCapabilities,
} from './utils/system-capabilities.js';
export type { PublicSystemCapabilities } from './utils/system-capabilities.js';

export {
  INTEGRATION_TOOL_PREFIX,
  isIntegrationToolId,
  parseIntegrationToolId,
} from './utils/integration-tool-id.js';

export type { CrewRosterPickerRecord, CrewRosterPickerStatus } from './types/crew-roster-picker.js';
export type { SessionResumeState, SessionResumeKind } from './types/session-resume.js';
export {
  automationRunSessionId,
  isAutomationSessionId,
  automationTaskIdFromSessionId,
  isUserFacingSession,
} from './utils/automation-session.js';
export {
  CHANNEL_SESSION_ID,
  isChannelSessionId,
  isSuperSessionId,
  resolveFleetToolSessionScope,
} from './utils/channel-session.js';

export {
  isMemoryFabricSuperSession,
  resolveMemoryFabricWriteSessionId,
  resolveMemoryFabricSearchSessionFilter,
} from './utils/memory-fabric-scope.js';

export {
  generateAxId,
  isAxId,
  parseAxId,
} from './utils/ax-id.js';
export type { AxEntity } from './utils/ax-id.js';

export {
  VOICE_BLOCK_OPEN,
  VOICE_BLOCK_CLOSE,
  normalizeVoiceAssistantContent,
} from './utils/voice-channel.js';

export type {
  DeepSearchContentType,
  DeepSearchDepth,
  DeepSearchScores,
  DeepSearchExtracted,
  DeepSearchResult,
  DeepSearchPlan,
  DeepSearchStats,
  DeepSearchProgress,
  DeepSearchResultBundle,
  DeepSearchRequest,
} from './types/deep-search.js';
