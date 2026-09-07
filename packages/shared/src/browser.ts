export {
  normalizeMessageForUi,
  rebuildPartsFromCanonical,
  shouldRebuildStoredParts,
  partsCorruptedByCrossTurn,
  partsToolIdsMismatch,
  partsTextExceedsContent,
  partsTextTruncatesContent,
  syncTextPartsWithCanonicalContent,
  textsOverlap,
  textsNearDuplicate,
  collapseOverlappingTextParts,
  suppressOverlappingAssistantTexts,
  textFromAssistantRecord,
  isSettledPersistedTurn,
  partsIndicateRunningTools,
  dedupeToolParts,
  dedupeResponseDocumentParts,
  buildPartsFromDbRows,
  assignPartsToAssistantMessage,
  buildPartsForPersist,
  appendThinkingDeltaToParts,
  sealTrailingThinkingPart,
  isReasoningPartType,
  extractThinkingFromMessage,
} from './utils/message-parts.js';

export type { MessagePart, PersistedToolCall } from './utils/message-parts.js';

export { appendStreamText, repairStreamTextGlitches, extractStreamTextDelta } from './utils/stream-text.js';

export {
  sanitizeForJson,
  mapOverNonCodeSegments,
  decodeLiteralUnicodeEscapes,
  stripInvisibleFormatChars,
  stripResidualInvisibleEscapeSpellings,
  sanitizeAssistantDisplayText,
  stripToolNoise,
} from './utils/text-sanitize.js';

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
  upsertDownloadPart,
  attachDownloadPartsFromTools,
  parseDownloadProgressFromStream,
  parseDownloadProgressLine,
  downloadResultFromMetadata,
} from './utils/download-parts.js';
export type { DownloadPartPayload } from './utils/download-parts.js';

export { attachChartPartsFromTools } from './utils/chart-parts.js';
export { attachVisualPartsFromTools, visualItemFromPart } from './utils/visual-parts.js';
export {
  isVisualKind,
  isHttpUrl,
  visualKindFromMime,
  parseVisualSource,
  parseVisualItem,
  buildVisualItem,
} from './utils/visual-item.js';
export type { VisualItem, VisualKind, VisualSource } from './types/visual.js';
export { VISUAL_KINDS } from './types/visual.js';
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

export type {
  PermissionOutcomeRecord,
  PermissionOutcomeDecision,
} from './types/permission-outcome.js';

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

export type {
  HostConfig,
  HostExposureState,
  HostExposureScope,
  HostNetworkSnapshot,
  HostStatusSnapshot,
  TunnelStatus,
  TunnelLifecycleState,
  TunnelProviderId,
  TunnelProviderCatalogEntry,
  TunnelProviderCredentials,
  SecurityPosture,
  SecurityPostureCheck,
} from './types/host.js';
export { defaultHostConfig, mergeHostConfig } from './types/host.js';

export type {
  TelephonyConfig,
  TelephonyProviderId,
  TelephonyCapabilities,
  TelephonyProviderCatalogEntry,
  TelephonyProviderCredentials,
  TelephonyProviderConfig,
  TelephonyCredentialField,
  TelephonyNumberBindingConfig,
  TelephonyDefaultInboundMissionDraft,
  TelephonyRecordingPolicy,
  TelephonyAiDisclosure,
  VoiceCallMission,
  VoiceCallMissionEscalation,
  NormalizedTelephonyEvent,
  NormalizedTelephonyEventType,
} from './types/telephony.js';
export {
  defaultTelephonyConfig,
  mergeTelephonyConfig,
  DEFAULT_TELEPHONY_CAPABILITIES,
} from './types/telephony.js';

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
  VOICE_PERMISSION_COLLECT_MS,
  VOICE_PERMISSION_MAX_CLARIFY,
  VOICE_PERMISSION_CLARIFY_LINE,
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

export {
  RESPONSE_DOCUMENT_VERSION,
  MAX_RESPONSE_DOCUMENT_BYTES,
  MAX_RESPONSE_BLOCKS,
  MAX_RESPONSE_TABLE_CELLS,
  ResponseToneSchema,
  ResponseBlockSchema,
  ResponseDocumentSchema,
  parseResponseDocument,
  responseDocumentToMarkdown,
  responseDocumentPart,
} from './utils/response-document.js';

export type {
  ResponseTone,
  ResponseBlockV1,
  ResponseDocumentV1,
  ResponseDocumentParseResult,
} from './utils/response-document.js';

export {
  RICH_RESPONSE_COMPILE_DEADLINE_MS,
  RICH_RESPONSE_MAX_SOURCE_CHARS,
  RICH_RESPONSE_MIN_PARITY,
  shouldCompileRichResponse,
  responseDocumentSemanticParity,
  compileRichResponseDocument,
  compileRichResponsePart,
} from './utils/rich-response-compiler.js';

export type {
  RichResponseCompileInput,
  RichResponseCompileResult,
} from './utils/rich-response-compiler.js';

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
export { sanitizeArticleDeliverable } from './utils/article-deliverable.js';
export { deriveArticleTitle, isGenericArticleTitle } from './utils/article-title.js';
export type { DeriveArticleTitleInput } from './utils/article-title.js';
export {
  ARTICLE_KINDS,
  articleKindKicker,
  articleKindLabel,
  deriveArticleKind,
  isArticleKind,
} from './utils/article-kind.js';
export type { ArticleKind } from './utils/article-kind.js';
export {
  parseGfmTableCells,
  isGfmTableSeparator,
  isGfmTableRow,
  formatGfmTableRow,
  formatGfmTableSeparator,
  displayArticleTitle,
  humanizeArticleExcerpt,
  deriveArticleExcerpt,
  recoverArticleTableHeader,
} from './utils/article-table.js';
export { extractArticleFromLegacyTsx, normalizeArticleInput } from './utils/article-input.js';

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
  channelSessionIdForContact,
  parseChannelBindingFromSessionId,
  contactIdFromChannelSessionId,
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

export {
  CALL_DIVIDER_GAP_MS,
  CALL_DIVIDER_CONTENT_RE,
  decideCallDivider,
  parseCallDivider,
  readCallDividerMeta,
  formatCallDividerDuration,
  formatCallDividerDayLabel,
  formatCallDividerTimeLabel,
  buildNewConversationDividerMeta,
} from './utils/call-transcript-divider.js';
export type { CallDividerVariant, CallDividerMeta } from './utils/call-transcript-divider.js';

export {
  CREW_VOICE_SESSION_PREFIX,
  CREW_CALL_ANCHOR_PREFIX,
  crewVoiceSessionId,
  isCrewVoiceSessionId,
  crewCallAnchorId,
  isCrewCallAnchorId,
  textSessionIdFromVoiceSessionId,
} from './utils/crew-voice-session.js';

export {
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
  XAI_BARGE_IN_MIC_LEVEL,
  XAI_BARGE_IN_TRIGGER_LEVEL,
  XAI_BARGE_IN_TRIGGER_FRAMES,
  XAI_WAKE_BARGE_IN_TRIGGER_LEVEL,
  XAI_WAKE_BARGE_IN_TRIGGER_FRAMES,
  XAI_BARGE_IN_PLAYBACK_GRACE_MS,
  MIN_FIRST_PLAYBACK_SAMPLES,
  FIRST_PLAYBACK_START_DELAY_SEC,
  PLAYBACK_IDLE_NOTIFY_MS,
  XAI_SERVER_VAD,
  XAI_WAKE_SERVER_VAD,
  VOICE_USER_TRANSCRIPT_DEDUP_MS,
} from './utils/voice-duplex-params.js';

// Client situation — web-ui location context and docking display
export type {
  ClientSituation,
  ClientSituationSource,
  ClientLocationMethod,
  ClientLocationConfidence,
} from './types/client-situation.js';
export {
  normalizeClientSituation,
  isClientLocationKnown,
  clientLocationCityLabel,
  formatClientSituationBlock,
} from './utils/client-situation.js';

export {
  formatOwnerPublicName,
  formatOwnerReferralExample,
  mergeUserConfig,
  normalizeOwnerNames,
  isOwnerEmailValid,
  ownerPronouns,
} from './utils/owner-identity.js';
export type { UserConfig, UserGender, UserHonorificPrefix } from './types/config.js';
export { USER_HONORIFIC_PREFIXES, USER_GENDERS, USER_GENDER_LABELS } from './types/config.js';

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

export type { DownloadProgress, DownloadResult } from './types/download.js';

// Observability types (Phase 5+) — needed by the web-ui observability app.
export type {
  TraceKind,
  SpanKind,
  TraceSummary,
  SpanNode,
  ObservabilityLogEntry,
  MetricPoint,
  MetricSeries,
  ObservabilityConfig,
  TraceDetail,
  DevVerifyRequest,
  DevVerifyResponse,
  TraceDiagnosis,
  TraceExportBundle,
} from './types/observability.js';
export type { MetricSample, ObservabilityDomain } from './types/telemetry.js';

// Turn modes — needed by web-ui TurnModeChip component
export type { ThinkingMode, OutputMode } from './types/turn-mode.js';
export {
  THINKING_MODE_LABELS,
  OUTPUT_MODE_LABELS,
} from './types/turn-mode.js';
