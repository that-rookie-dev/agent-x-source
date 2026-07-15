/**
 * Model management helpers extracted from Agent.ts (REFACTOR-2).
 */
import { getLogger, resolveSpaceError, resolveTrialOutputTokens, modelInfoHasReasoning, DEFAULT_FALLBACK_CONTEXT_WINDOW, type EngineEvent, type ModelInfo } from '@agentx/shared';
import { isCompactContextProfile } from './context-profile.js';

export interface ModelTrialContext {
  cachedModelInfo: Map<string, { outputTokenLimit?: number; contextWindow?: number; id: string; name: string; providerId: string; capabilities: string[] }>;
  groundedModels: Set<string>;
  provider: { complete(request: unknown): AsyncIterable<unknown> };
  config: { provider: { activeProvider: string; activeModel: string } };
  emit(event: EngineEvent): void;
}

/**
 * Trial a model with a minimal API call BEFORE committing it.
 * Returns true if the model works, false if it's grounded.
 */
export async function trialModel(ctx: ModelTrialContext, modelId: string): Promise<boolean> {
  const logger = getLogger();
  try {
    const info = ctx.cachedModelInfo.get(modelId);
    const request = {
      model: modelId,
      messages: [{ role: 'user' as const, content: 'hi' }],
      maxTokens: resolveTrialOutputTokens({
        outputTokenLimit: info?.outputTokenLimit,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of ctx.provider.complete(request)) {
      break; // Just need first chunk to confirm it works
    }
    ctx.groundedModels.delete(modelId);
    return true;
  } catch (err) {
    logger.error('MODEL_TRIAL_FAILED', err, { modelId });
    ctx.groundedModels.add(modelId);
    const rawTrialMessage = err instanceof Error ? err.message : String(err);
    const statusCode = typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status: number }).status
      : undefined;
    ctx.emit({
      type: 'provider_error',
      provider: ctx.config.provider.activeProvider,
      model: modelId,
      statusCode,
      message: rawTrialMessage,
      recoverable: true,
      actions: [
        { type: 'switch_model', label: 'Pick a different model' },
        { type: 'reconfigure_key', label: 'Update API key' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    } as EngineEvent);
    return false;
  }
}

export interface ModelListContext {
  cachedModelInfo: Map<string, { id: string; name: string; providerId: string; contextWindow?: number; capabilities: string[]; outputTokenLimit?: number }>;
  provider: { listModels(): Promise<Array<{ id: string; name: string; providerId: string; contextWindow?: number; capabilities: string[]; outputTokenLimit?: number }>> };
  config: { provider: { activeModel: string } };
  emit(event: EngineEvent): void;
}

/**
 * List available models from the provider and cache their metadata.
 */
export async function listModels(ctx: ModelListContext): Promise<void> {
  const logger = getLogger();
  try {
    const models = await ctx.provider.listModels();
    if (models.length === 0) {
      ctx.emit({
        type: 'error',
        code: 'NO_MODELS',
        message: '🏚 Hangar Empty — No models returned by the API. Verify your key has correct permissions.',
        recoverable: true,
        actions: [{ type: 'dismiss', label: 'Dismiss' }],
      } as EngineEvent);
      return;
    }
    for (const m of models) {
      ctx.cachedModelInfo.set(m.id, m);
    }
    ctx.emit({
      type: 'command_action',
      action: 'list_models',
      models,
      currentModel: ctx.config.provider.activeModel,
    } as EngineEvent);
  } catch (err) {
    logger.error('MODEL_LIST_FAILED', err);
    const spaceErr = resolveSpaceError(err);
    ctx.emit({
      type: 'error',
      code: 'MODEL_LIST_FAILED',
      message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
      recoverable: true,
      actions: [{ type: 'dismiss', label: 'Dismiss' }],
    } as EngineEvent);
  }
}

export interface SwitchModelContext {
  usesCompactContext(): boolean;
  config: { provider: { activeProvider: string; activeModel: string } };
  cachedModelInfo: Map<string, { id: string; name: string; providerId: string; contextWindow?: number; capabilities: string[]; outputTokenLimit?: number }>;
  tokenTracker: { setTotal(n: number): void; tokensTotal: number };
  setPromptEngine(ctx: number): void;
  sessionManager: { persistSessionFields?(sessionId: string, fields: Record<string, unknown>): void } | null;
  sessionId: string;
  rebuildPromptAssembly(): void;
  syncSessionRuntimeRecord(patch: { modelId: string; providerId: string }): void;
  emit(event: EngineEvent): void;
  _capabilityWarningEmitted: boolean;
  setCapabilityWarningEmitted(v: boolean): void;
}

/**
 * Switch the active model and update token tracking + prompt engine.
 */
export function switchModel(ctx: SwitchModelContext, modelId: string, contextWindow?: number): void {
  const wasCompact = ctx.usesCompactContext();
  ctx.config.provider.activeModel = modelId;
  ctx.setCapabilityWarningEmitted(false);

  const ctxWin = contextWindow ?? ctx.cachedModelInfo.get(modelId)?.contextWindow;
  if (ctxWin) {
    ctx.tokenTracker.setTotal(ctxWin);
    const existing = ctx.cachedModelInfo.get(modelId);
    ctx.cachedModelInfo.set(modelId, existing ? { ...existing, contextWindow: ctxWin } : {
      id: modelId,
      name: modelId,
      providerId: ctx.config.provider.activeProvider,
      contextWindow: ctxWin,
      capabilities: [],
    });
    ctx.setPromptEngine(ctxWin);
    try {
      ctx.sessionManager?.persistSessionFields?.(ctx.sessionId, { tokenAvailable: ctxWin });
    } catch { /* best-effort */ }
  }

  const nowCompact = isCompactContextProfile(
    ctx.config.provider.activeProvider,
    modelId,
    ctxWin ?? 0,
  );
  if (wasCompact !== nowCompact) {
    ctx.rebuildPromptAssembly();
  }

  ctx.syncSessionRuntimeRecord({
    modelId,
    providerId: ctx.config.provider.activeProvider,
  });

  ctx.emit({ type: 'command_action', action: 'model_switched', modelId, contextWindow: ctxWin ?? ctx.tokenTracker.tokensTotal } as EngineEvent);
}

export interface ModelCapsContext {
  cachedModelInfo: Map<string, ModelInfo | undefined>;
  config: { provider: { activeModel: string } };
}

/**
 * Get the active model's capabilities (reasoning, context window, output token limit).
 */
export function getActiveModelCaps(ctx: ModelCapsContext): {
  hasReasoning: boolean;
  contextWindow?: number;
  outputTokenLimit?: number;
} {
  const info = ctx.cachedModelInfo.get(ctx.config.provider.activeModel);
  return {
    hasReasoning: modelInfoHasReasoning(info),
    contextWindow: info?.contextWindow,
    outputTokenLimit: info?.outputTokenLimit,
  };
}

export interface ContextWindowContext {
  config: { provider: { activeModel: string } };
  cachedModelInfo: Map<string, ModelInfo | undefined>;
  tokenTracker: { tokensTotal: number };
}

/**
 * Get the effective context window for the active model.
 */
export function getContextWindow(ctx: ContextWindowContext): number {
  const modelId = ctx.config.provider.activeModel;
  const cached = modelId ? ctx.cachedModelInfo.get(modelId) : undefined;
  if (cached?.contextWindow) return cached.contextWindow;
  if (ctx.tokenTracker?.tokensTotal) {
    return ctx.tokenTracker.tokensTotal;
  }
  return DEFAULT_FALLBACK_CONTEXT_WINDOW;
}
