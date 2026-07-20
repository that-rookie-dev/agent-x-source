import type {
  Message,
  EngineEvent,
  CompletionMessage,
  AgentXConfig,
  QuestionnairePayload,
  ClientSituation,
} from '@agentx/shared';
import type { SessionLogger } from '../../session/SessionLogger.js';
import type { TokenTracker } from '../../session/TokenTracker.js';
import type { GitManager } from '../../session/GitManager.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { ToolExecutor } from '../../tools/ToolExecutor.js';
import type { ThirdPartyTurnPolicy } from '../../integrations/third-party-access.js';
import type { PartPersistFn } from '../../agent/AiSdkStreamHandler.js';
import type { TurnStateManager } from '../../agent/TurnStateManager.js';
import type { ToolLedger } from '../../agent/ToolLedger.js';
import type { WebSearchTurnPolicy } from '../../search/web-search-policy.js';
import type { SessionEvent } from '@agentx/shared';

/** Per-turn options for a completion-loop run. */
export interface TurnRunOptions {
  /** Turn start timestamp (Date.now()) — used for elapsed calculations and telemetry ids. */
  startTime: number;
  /** Optional abort signal for this turn. Combined with the host abortSignal. */
  signal?: AbortSignal;
}

/** Subset of AgentOptions the completion loop needs. */
export interface TurnHostOptions {
  promptProfile?: 'default' | 'crew_worker' | 'crew_private' | 'voice';
  channelSession?: boolean;
  prepareIntegrationTools?: (userText: string) => Promise<
    string | { hint?: string; policy?: ThirdPartyTurnPolicy } | undefined | null
  >;
}

/**
 * The narrow seam between the Agent facade and the TurnOrchestrator.
 *
 * The orchestrator owns the model-call/tool-call loop; everything it needs
 * from the agent (mutable turn state, services, wait-gates, prompt helpers)
 * is exposed here explicitly so the dependency surface is visible and
 * testable. Mutable properties write through to the agent's state.
 */
export interface TurnOrchestratorHost {
  // ── Identity / configuration ──────────────────────────────────────────
  readonly sessionId: string;
  readonly config: AgentXConfig;
  readonly options: TurnHostOptions;
  readonly isDelegatedWorker: boolean;
  readonly abortSignal: AbortSignal | undefined;
  readonly maxCompletionSteps: number;
  readonly crewPrivateCompletionSteps: number;

  // ── Conversation / turn state (live references) ───────────────────────
  readonly messages: CompletionMessage[];
  readonly toolCallLogForReflection: Array<{ name: string; success: boolean; output: string; elapsed: number }>;
  readonly turnState: TurnStateManager;
  readonly toolLedger: ToolLedger;
  readonly tokenTracker: TokenTracker;
  pendingInstruction: string | null;
  partialTurnContent: string;
  lastMissionContextRevision: number;
  activeStreamHandler: { discardCurrentStepText: () => void } | null;
  readonly pendingVoiceMerge: { messageId: string; prefixContent: string } | null;
  readonly clientSituation: ClientSituation | null;
  readonly lastRagResults: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>;
  readonly turnWebSearchPolicy: WebSearchTurnPolicy;
  readonly forcedWebSearchToolName: 'deep_web_search' | 'web_search' | null;
  readonly missionContextProvider: (() => { revision: number; block: string }) | undefined;

  // ── Services / components ─────────────────────────────────────────────
  readonly toolRegistry: ToolRegistry | undefined;
  readonly toolExecutor: ToolExecutor | undefined;
  readonly gitManager: GitManager | null;
  readonly sessionLogger: SessionLogger | null;
  readonly onPart: PartPersistFn | undefined;
  readonly onSessionEvent: ((event: SessionEvent) => void) | null;
  readonly onTokenLog: ((opts: { inputTokens: number; outputTokens: number; costUsd: number; crewId?: string }) => void) | null;

  // ── Callbacks into the facade ─────────────────────────────────────────
  emit(event: EngineEvent): void;
  reconcileSystemPrompt(): Promise<void>;
  compactContext(promptEstimate?: number): Promise<boolean>;
  usesCompactContext(): boolean;
  getApiKey(): string | undefined;
  getContextWindow(): number;
  getActiveModelCaps(): { hasReasoning: boolean; contextWindow?: number; outputTokenLimit?: number };
  completionStepBudget(): number;
  setThirdPartyTurnPolicy(policy: ThirdPartyTurnPolicy | null): void;
  waitForQuestionnaireResponse(questionnaire: QuestionnairePayload): Promise<string>;
  waitForStepCap(currentSteps: number): Promise<boolean>;
  runDelegatedSubAgent(
    instruction: string,
    toolsList: string[] | undefined,
    timeout: number,
    background?: boolean,
  ): Promise<{ success: boolean; output: string; elapsed: number; agentId?: string }>;
  reinforceMemoryContext(): Promise<void>;
  tagCrewPrivateAssistant(msg: Message): Message;
  prepareTurnContext(currentUserMessage: string): { block: string };
  buildRagContext(results: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>): string;
}

/**
 * Runs a single agent turn: the streaming model-call/tool-call loop,
 * including prompt budgeting, step caps, retries, and recovery messages.
 */
export interface ITurnOrchestrator {
  runTurn(sessionId: string, userText: string, opts: TurnRunOptions): Promise<Message>;
}
