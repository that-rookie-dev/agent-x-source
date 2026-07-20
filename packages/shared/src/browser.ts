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

export { attachChartPartsFromTools } from './utils/chart-parts.js';
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
  formatQuestionnaireForMessagingChannel,
  extractAssistantReplyText,
  questionnaireSupportsInlineButtons,
  MESSAGING_INLINE_MAX_OPTIONS,
  MESSAGING_INLINE_MAX_QUESTIONS,
} from './utils/questionnaire.js';

export {
  PERMISSION_INSTRUCTED_ERROR,
  isPermissionInstructResult,
  normalizePermissionHandlerResult,
  formatPermissionInstructedToolOutput,
} from './utils/messaging-permission.js';
export type { PermissionHandlerResult, PermissionInstructResult } from './utils/messaging-permission.js';
export {
  VOICE_PERMISSION_TIMEOUT_MS,
  VOICE_PERMISSION_TIMEOUT_INSTRUCTION,
} from './utils/voice-permission.js';

export {
  CHART_P0_TYPES,
  CHART_P1_TYPES,
  CHART_P2_TYPES,
  CHART_ALL_TYPES,
  CHART_FENCE_LANGS,
  MAX_CHART_ROWS,
  MAX_CHART_SERIES,
  MAX_PIE_SLICES,
  DEFAULT_CHART_HEIGHT,
  ChartSpecSchema,
  isChartSpecContent,
  isIncompleteChartJson,
  isMermaidSource,
  mermaidSpecFromSource,
  parseChartSpec,
  chartBlockTitle,
  resolveChartHeight,
  chartSpecFromTable,
} from './utils/chart-spec.js';

export type {
  ChartP0Type,
  ChartP1Type,
  ChartP2Type,
  ChartType,
  ChartSpec,
  ChartParseResult,
} from './utils/chart-spec.js';

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
export { sanitizeMarkdownDeliverable } from './utils/markdown-deliverable.js';
export { deriveMarkdownTitle, isGenericMarkdownTitle } from './utils/markdown-title.js';
export type { DeriveMarkdownTitleInput } from './utils/markdown-title.js';

export { explicitCrewRequest, prefersCrewRosterFirst, isWorkforceOrSpecialistNeed } from './utils/crew-roster-intent.js';

export {
  NEURAL_CORTEX_BGE_MIN_RAM_GB,
  LOCAL_MODEL_MIN_RAM_GB,
  VOICE_WARMUP_MIN_RAM_GB,
  getSystemMemoryGB,
  isLocalModelSupported,
  isVoiceWarmupSupported,
  buildPublicSystemCapabilities,
  resolveNeuralCortexEmbeddingTier,
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
  channelSessionIdForBinding,
  parseChannelBindingFromSessionId,
  isChannelSessionId,
  isSuperSessionId,
  resolveFleetToolSessionScope,
  resolveAutomationSessionScope,
} from './utils/channel-session.js';
export {
  CHANNEL_COVERED_MCP_INTEGRATION_IDS,
  isChannelCoveredMcpIntegration,
  detectChannelHandoffIntent,
  isBareContinueIntent,
} from './utils/channel-integration-overlap.js';
export {
  buildResumeTurnInstructionFromMessages,
  resolveContinuationInstruction,
  isContinuationTrigger,
  detectIncompleteLastTurn,
} from './utils/resume-turn.js';
export type { ResumeTurnMessage } from './utils/resume-turn.js';
export type { ChannelCoveredMcpIntegrationId } from './utils/channel-integration-overlap.js';
export {
  formatChannelBindingLabel,
} from './utils/channel-session-binding.js';
export type { ChannelBindingId, ChannelSessionBinding } from './utils/channel-session-binding.js';

export {
  isMemoryFabricSuperSession,
  resolveMemoryFabricWriteSessionId,
  resolveMemoryFabricSearchSessionFilter,
} from './utils/memory-fabric-scope.js';

export {
  crewParticipationMode,
  allowsCrewInvolvement,
  deniesAutonomousCrewTools,
} from './utils/crew-session-policy.js';
export type { CrewParticipationMode, CrewInvolvementVia } from './utils/crew-session-policy.js';

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

export { formatProviderErrorMessage } from './utils/provider-error-message.js';

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
