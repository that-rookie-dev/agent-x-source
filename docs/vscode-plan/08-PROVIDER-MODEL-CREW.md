# Phase 8: Provider, Model, and Crew Switching UI

> **Status**: ⬜ Not Started
> **Depends on**: Phase 3 (Extension Core), Phase 5 (Tool Adaptation), Phase 6 (Permissions & Scope)
> **Estimated Effort**: 3 days
> **Files Created**: `packages/vscode/src/commands/ProviderPicker.ts`, `packages/vscode/src/commands/ModelPicker.ts`, `packages/vscode/src/commands/ProviderConfig.ts`, `packages/vscode/src/commands/CrewPicker.ts`, `packages/vscode/src/commands/CrewCreator.ts`, `packages/vscode/src/commands/CrewEditor.ts`, `packages/vscode/src/statusbar/ProviderModelStatusBar.ts`, `packages/vscode/src/config/ConfigSync.ts`

---

## Overview

Phase 8 implements the full provider, model, and crew/profile switching UI for the Agent-X VS Code extension. This includes QuickPick-based pickers for providers, models, and crews; multi-step configuration wizards; status bar integration with live updates; and bidirectional configuration synchronization between the VS Code settings layer and the CLI/TUI config file at `~/.config/agentx/config.json`.

All engine interactions use the existing `Agent` methods (`switchProvider`, `switchModel`, `listModels`, `trialModel`, `rebuildSystemPrompt`) and the `CrewManager` / `ProviderFactory` APIs without modification.

---

## Task Index

| Task ID | Title | Status | Dependencies |
|---------|-------|--------|-------------|
| T8.1 | Provider Picker | ⬜ | Phase 3 |
| T8.2 | Model Picker | ⬜ | Phase 3 |
| T8.3 | Provider Configuration Panel | ⬜ | T8.1 |
| T8.4 | Crew Picker | ⬜ | Phase 3 |
| T8.5 | Crew Creator | ⬜ | Phase 3 |
| T8.6 | Crew Editor | ⬜ | T8.4 |
| T8.7 | Provider/Model Status Bar Integration | ⬜ | T8.1, T8.2 |
| T8.8 | Configuration Sync | ⬜ | Phase 3 |
| T8.9 | Verification | ⬜ | All above |

---

## T8.1: Provider Picker

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/commands/ProviderPicker.ts`
**Estimated Effort**: 4 hours

### T8.1.1: Provider Metadata Registry

A static registry of all 15 supported providers with display metadata used across the picker, config wizard, and status bar.

```typescript
// packages/vscode/src/commands/ProviderPicker.ts

import * as vscode from "vscode";
import type { ProviderId } from "@agentx/shared";
import { ProviderFactory } from "@agentx/engine/providers/index";
import type { CommandDeps } from "./registerAllCommands";

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  icon: string;
  type: "cloud" | "local";
  apiKeyRequired: boolean;
  baseUrlConfigurable: boolean;
  defaultBaseUrl: string;
  envVarName: string;
  description: string;
}

export const PROVIDER_REGISTRY: ProviderMeta[] = [
  {
    id: "openai",
    name: "OpenAI",
    icon: "$(sparkle)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.openai.com/v1",
    envVarName: "OPENAI_API_KEY",
    description: "GPT-4o, GPT-4, o1, o3, etc.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    icon: "$(brain)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.anthropic.com",
    envVarName: "ANTHROPIC_API_KEY",
    description: "Claude 4 Sonnet, Claude 3.5 Opus, etc.",
  },
  {
    id: "google",
    name: "Google",
    icon: "$(globe)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    envVarName: "GOOGLE_API_KEY",
    description: "Gemini 2.5 Pro, Gemini 2.0 Flash, etc.",
  },
  {
    id: "ollama",
    name: "Ollama",
    icon: "$(server)",
    type: "local",
    apiKeyRequired: false,
    baseUrlConfigurable: true,
    defaultBaseUrl: "http://localhost:11434",
    envVarName: "",
    description: "Local models via Ollama",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    icon: "$(server)",
    type: "local",
    apiKeyRequired: false,
    baseUrlConfigurable: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    envVarName: "",
    description: "Local models via LM Studio",
  },
  {
    id: "moonshot",
    name: "Moonshot",
    icon: "$(rocket)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    envVarName: "MOONSHOT_API_KEY",
    description: "Kimi models via OpenAI-compatible API",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "$(search)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.deepseek.com",
    envVarName: "DEEPSEEK_API_KEY",
    description: "DeepSeek-V3, DeepSeek-R1 reasoning models",
  },
  {
    id: "groq",
    name: "Groq",
    icon: "$(zap)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    envVarName: "GROQ_API_KEY",
    description: "Ultra-fast inference on LPU hardware",
  },
  {
    id: "mistral",
    name: "Mistral",
    icon: "$(wind)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    envVarName: "MISTRAL_API_KEY",
    description: "Mistral Large, Mixtral, Codestral, etc.",
  },
  {
    id: "together",
    name: "Together AI",
    icon: "$(people)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.together.xyz/v1",
    envVarName: "TOGETHER_API_KEY",
    description: "Open-source models hosted in the cloud",
  },
  {
    id: "xai",
    name: "xAI",
    icon: "$(star-empty)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.x.ai/v1",
    envVarName: "XAI_API_KEY",
    description: "Grok models from xAI",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    icon: "$(flame)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    envVarName: "FIREWORKS_API_KEY",
    description: "Fast inference for open-source models",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    icon: "$(question)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.perplexity.ai",
    envVarName: "PERPLEXITY_API_KEY",
    description: "Sonar models with built-in search",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    icon: "$(azure)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: true,
    defaultBaseUrl: "",
    envVarName: "AZURE_OPENAI_API_KEY",
    description: "Azure-hosted OpenAI models (requires resource endpoint)",
  },
  {
    id: "cohere",
    name: "Cohere",
    icon: "$(symbol-key)",
    type: "cloud",
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: "https://api.cohere.com/compatibility/v1",
    envVarName: "COHERE_API_KEY",
    description: "Command R+, Command R, Embed models",
  },
];

export function getProviderMeta(id: ProviderId): ProviderMeta | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}
```

**Acceptance Criteria**:
- All 15 providers from `ProviderId` union type are represented
- Each entry has: `id`, `name`, `icon`, `type`, `apiKeyRequired`, `baseUrlConfigurable`, `defaultBaseUrl`, `envVarName`, `description`
- `getProviderMeta()` lookup function exported
- Icons use VS Code codicons

---

### T8.1.2: ProviderPicker QuickPick

```typescript
interface ProviderQuickPickItem extends vscode.QuickPickItem {
  providerId: ProviderId;
}

export function showProviderPicker(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const activeProvider = deps.configBridge.getActiveProvider();

    const items: ProviderQuickPickItem[] = PROVIDER_REGISTRY.map((p) => {
      const isActive = p.id === activeProvider;
      const typeLabel = p.type === "cloud" ? "$(cloud) Cloud" : "$(server) Local";
      const keyLabel = p.apiKeyRequired ? "$(key) API Key Required" : "$(pass) No Key Needed";

      return {
        label: isActive ? `$(check) ${p.icon} ${p.name}` : `${p.icon} ${p.name}`,
        description: `${typeLabel}  ${keyLabel}`,
        detail: p.description,
        providerId: p.id,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select AI provider",
      matchOnDescription: true,
      matchOnDetail: true,
      title: "Agent-X: Switch Provider",
    });

    if (!selected) return;

    const meta = getProviderMeta(selected.providerId);
    if (!meta) return;

    if (selected.providerId === activeProvider) {
      vscode.window.showInformationMessage(
        `Agent-X: Already using ${meta.name}.`
      );
      return;
    }

    try {
      await configureAndSwitchProvider(deps, meta);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Provider switch failed — ${error instanceof Error ? error.message : String(error)}`
      );
      deps.outputChannel.appendLine(`[Agent-X] Provider switch error: ${error}`);
    }
  };
}
```

**Acceptance Criteria**:
- QuickPick shows all 15 providers with icons, type (cloud/local), and API key indicator
- Active provider marked with `$(check)` icon
- Searchable by name, type, and description
- Selecting the already-active provider shows info message and returns early
- Errors caught and displayed to user

---

### T8.1.3: Provider Configuration and Switching Logic

```typescript
async function configureAndSwitchProvider(
  deps: CommandDeps,
  meta: ProviderMeta
): Promise<void> {
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  if (meta.apiKeyRequired) {
    apiKey = await vscode.window.showInputBox({
      prompt: `Enter API key for ${meta.name}`,
      placeHolder: `Paste your ${meta.envVarName} here`,
      password: true,
      ignoreFocusOut: true,
      title: `Agent-X: Configure ${meta.name} — API Key`,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "API key is required for this provider";
        }
        return undefined;
      },
    });

    if (!apiKey) return;
    apiKey = apiKey.trim();
  }

  if (meta.baseUrlConfigurable) {
    baseUrl = await vscode.window.showInputBox({
      prompt: `Enter base URL for ${meta.name}`,
      placeHolder: meta.defaultBaseUrl || "https://your-resource.openai.azure.com",
      value: deps.configBridge.getProviderBaseUrl(meta.id) || meta.defaultBaseUrl,
      ignoreFocusOut: true,
      title: `Agent-X: Configure ${meta.name} — Base URL`,
      validateInput: (value) => {
        if (value && value.trim().length > 0) {
          try {
            new URL(value);
          } catch {
            return "Must be a valid URL (e.g., https://api.example.com)";
          }
        }
        if (meta.id === "azure" && (!value || value.trim().length === 0)) {
          return "Azure OpenAI requires a base URL (resource endpoint)";
        }
        return undefined;
      },
    });

    if (meta.id === "azure" && !baseUrl) return;
    baseUrl = baseUrl?.trim() || meta.defaultBaseUrl;
  }

  const isValid = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Validating ${meta.name} connection...`,
      cancellable: false,
    },
    async () => {
      try {
        const provider = ProviderFactory.create(meta.id, apiKey, baseUrl);
        return await provider.validate();
      } catch {
        return false;
      }
    }
  );

  if (!isValid) {
    const retry = await vscode.window.showErrorMessage(
      `Agent-X: ${meta.name} validation failed. Check your API key and try again.`,
      "Retry",
      "Cancel"
    );
    if (retry === "Retry") {
      await configureAndSwitchProvider(deps, meta);
    }
    return;
  }

  if (apiKey) {
    deps.configBridge.setProviderApiKey(meta.id, apiKey);
  }
  if (baseUrl) {
    deps.configBridge.setProviderBaseUrl(meta.id, baseUrl);
  }
  deps.configBridge.setActiveProvider(meta.id);
  await deps.configBridge.saveConfig();

  await deps.engineLifecycle.switchProvider(meta.id, apiKey, baseUrl);
  deps.statusBarManager.updateProviderIndicator(meta.id);

  const models = await deps.engineLifecycle.getAvailableModels(meta.id);
  if (models.length > 0) {
    const defaultModel = models[0].id;
    deps.configBridge.setActiveModel(defaultModel);
    await deps.engineLifecycle.switchModel(defaultModel, models[0].contextWindow);
    deps.statusBarManager.updateModelIndicator(defaultModel, models[0].contextWindow);
  }

  vscode.window.showInformationMessage(
    `Agent-X: Switched to ${meta.name}. ${models.length} model(s) available.`
  );
  deps.outputChannel.appendLine(
    `[Agent-X] Provider switched to ${meta.id}, ${models.length} models available.`
  );
}
```

**Acceptance Criteria**:
- Cloud providers: prompts for API key with password masking
- Local providers: prompts for base URL with default value
- Azure: requires both API key and base URL (resource endpoint)
- Validation via `ProviderFactory.create().validate()` with progress indicator
- Failed validation offers retry
- Config saved to `~/.config/agentx/config.json` via ConfigManager
- Engine provider switched via `agent.switchProvider()`
- Status bar updated with new provider and default model
- Output channel logs the switch

---

### T8.1.4: Provider Picker Acceptance Criteria (Summary)

| Criterion | Details |
|-----------|---------|
| All 15 providers shown | openai, anthropic, google, ollama, lmstudio, moonshot, deepseek, groq, mistral, together, xai, fireworks, perplexity, azure, cohere |
| Icons per provider | Each provider has a unique codicon |
| Type indicator | Cloud vs Local clearly labeled |
| API key indicator | Shows whether key is required |
| Active provider marked | Check icon on current provider |
| Cloud flow | API key input → validate → save → switch |
| Local flow | Base URL input → validate → save → switch |
| Azure flow | API key + base URL → validate → save → switch |
| Validation | `ProviderFactory.create().validate()` with progress |
| Retry on failure | Error message with retry option |
| Config persistence | Saved to `~/.config/agentx/config.json` |
| Engine switch | `agent.switchProvider(providerId, apiKey?, baseUrl?)` |
| Status bar update | Provider and model indicators refreshed |
| Default model | First model from new provider auto-selected |

---

## T8.2: Model Picker

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/commands/ModelPicker.ts`
**Estimated Effort**: 3 hours

### T8.2.1: Model QuickPick with Search/Filter

```typescript
// packages/vscode/src/commands/ModelPicker.ts

import * as vscode from "vscode";
import type { ModelInfo } from "@agentx/shared";
import type { CommandDeps } from "./registerAllCommands";

interface ModelQuickPickItem extends vscode.QuickPickItem {
  modelId: string;
  contextWindow: number;
}

export function showModelPicker(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const currentProvider = deps.configBridge.getActiveProvider();
    const activeModel = deps.configBridge.getActiveModel();

    const models = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching models from ${currentProvider}...`,
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          return await deps.engineLifecycle.getAvailableModels(currentProvider);
        } catch {
          return [] as ModelInfo[];
        }
      }
    );

    if (!models || models.length === 0) {
      const action = await vscode.window.showWarningMessage(
        `Agent-X: No models available for provider "${currentProvider}". Check your API key or provider configuration.`,
        "Configure Provider",
        "Dismiss"
      );
      if (action === "Configure Provider") {
        await vscode.commands.executeCommand("agentx.configureProvider");
      }
      return;
    }

    const groundedModels = deps.engineLifecycle.getGroundedModels();

    const items: ModelQuickPickItem[] = models.map((m) => {
      const isActive = m.id === activeModel;
      const isGrounded = groundedModels.has(m.id);
      const ctxLabel = formatContextWindow(m.contextWindow);
      const caps = m.capabilities?.join(", ") || "";

      let label: string;
      if (isActive) {
        label = `$(check) ${m.name || m.id}`;
      } else if (isGrounded) {
        label = `$(warning) ${m.name || m.id}`;
      } else {
        label = m.name || m.id;
      }

      return {
        label,
        description: ctxLabel,
        detail: isGrounded
          ? `$(warning) Failed pre-flight check — ${caps}`
          : caps || m.id,
        modelId: m.id,
        contextWindow: m.contextWindow,
      };
    });

    items.sort((a, b) => {
      if (a.modelId === activeModel) return -1;
      if (b.modelId === activeModel) return 1;
      return a.label.localeCompare(b.label);
    });

    const quickPick = vscode.window.createQuickPick<ModelQuickPickItem>();
    quickPick.items = items;
    quickPick.placeholder = `Select model for ${currentProvider} (${models.length} available)`;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.title = "Agent-X: Switch Model";
    quickPick.busy = false;

    const result = await new Promise<ModelQuickPickItem | undefined>((resolve) => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        resolve(selected);
        quickPick.dispose();
      });
      quickPick.onDidHide(() => {
        resolve(undefined);
        quickPick.dispose();
      });
      quickPick.show();
    });

    if (!result) return;

    if (result.modelId === activeModel) {
      vscode.window.showInformationMessage(
        `Agent-X: Already using ${result.modelId}.`
      );
      return;
    }

    await trialAndSwitchModel(deps, result.modelId, result.contextWindow, result.label.replace("$(check) ", "").replace("$(warning) ", ""));
  };
}
```

**Acceptance Criteria**:
- Fetches models via `deps.engineLifecycle.getAvailableModels()` with progress indicator
- Empty model list shows warning with option to configure provider
- Active model marked with `$(check)` icon
- Grounded models (failed trial) marked with `$(warning)` icon
- Each item shows model name and context window size
- Detail line shows capabilities or grounded warning
- Items sorted: active model first, then alphabetical
- Searchable/filterable via QuickPick's built-in filter
- Uses `createQuickPick` for full control over the UI
- Selecting active model shows info message and returns early

---

### T8.2.2: Model Trial and Switch

```typescript
async function trialAndSwitchModel(
  deps: CommandDeps,
  modelId: string,
  contextWindow: number,
  displayName: string
): Promise<void> {
  deps.statusBarManager.showModelTrialIndicator(modelId);

  const trialResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Testing model "${displayName}"...`,
      cancellable: false,
    },
    async () => {
      try {
        return await deps.engineLifecycle.trialModel(modelId);
      } catch {
        return false;
      }
    }
  );

  deps.statusBarManager.hideModelTrialIndicator();

  if (!trialResult) {
    const action = await vscode.window.showWarningMessage(
      `Agent-X: Model "${displayName}" failed pre-flight check. It may be unavailable or your API key lacks permission.`,
      "Pick Another Model",
      "Dismiss"
    );
    if (action === "Pick Another Model") {
      await vscode.commands.executeCommand("agentx.switchModel");
    }
    return;
  }

  deps.configBridge.setActiveModel(modelId);
  await deps.engineLifecycle.switchModel(modelId, contextWindow);
  await deps.configBridge.saveConfig();

  deps.statusBarManager.updateModelIndicator(modelId, contextWindow);

  vscode.window.showInformationMessage(
    `Agent-X: Switched to model "${displayName}" (${formatContextWindow(contextWindow)} context).`
  );
  deps.outputChannel.appendLine(
    `[Agent-X] Model switched to ${modelId} (ctx: ${contextWindow}).`
  );
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K tokens`;
  return `${tokens} tokens`;
}
```

**Acceptance Criteria**:
- Status bar shows loading indicator during trial
- Progress notification shown during trial
- Trial uses `deps.engineLifecycle.trialModel(modelId)`
- Failed trial: warning with option to pick another model
- Successful trial: model switched via `agent.switchModel(modelId, contextWindow)`
- Config saved to disk
- Status bar updated with new model name and context window
- Output channel logs the switch
- Context window formatted human-readably (e.g., "128K tokens", "1.0M tokens")

---

### T8.2.3: Model Picker Acceptance Criteria (Summary)

| Criterion | Details |
|-----------|---------|
| Model list fetched | Via `agent.listModels()` through engine lifecycle |
| Progress indicator | Shown while fetching models |
| Empty list handled | Warning with option to configure provider |
| Active model marked | `$(check)` icon |
| Grounded models marked | `$(warning)` icon with detail message |
| Context window shown | Human-readable format in description |
| Capabilities shown | In detail line |
| Search/filter | QuickPick built-in filtering |
| Trial before switch | `agent.trialModel()` with progress |
| Trial failure | Warning + option to pick another |
| Trial success | Switch + save + status bar update |
| Config persistence | Saved to `~/.config/agentx/config.json` |

---

## T8.3: Provider Configuration Panel

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/commands/ProviderConfig.ts`
**Estimated Effort**: 5 hours

### T8.3.1: Multi-Step Configuration Wizard

```typescript
// packages/vscode/src/commands/ProviderConfig.ts

import * as vscode from "vscode";
import type { ProviderId } from "@agentx/shared";
import { ProviderFactory } from "@agentx/engine/providers/index";
import type { CommandDeps } from "./registerAllCommands";
import { PROVIDER_REGISTRY, getProviderMeta } from "./ProviderPicker";

interface ProviderProfile {
  id: string;
  providerId: ProviderId;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  createdAt: string;
}

export function showProviderConfig(deps: CommandDeps): (providerId?: string) => Promise<void> {
  return async (providerId?: string) => {
    // Step 1: Provider selection (if not passed)
    if (!providerId) {
      const existingProfiles = deps.configBridge.getProviderProfiles();

      interface ProfilePickItem extends vscode.QuickPickItem {
        providerId: ProviderId;
        profileId?: string;
        action: "configure_new" | "edit_existing" | "switch_profile";
      }

      const items: ProfilePickItem[] = [];

      if (existingProfiles.length > 0) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator } as ProfilePickItem);
        for (const profile of existingProfiles) {
          const meta = getProviderMeta(profile.providerId);
          const isActive = profile.id === deps.configBridge.getActiveProfileId();
          items.push({
            label: isActive ? `$(check) ${meta?.icon || "$(circuit-board)"} ${profile.name}` : `${meta?.icon || "$(circuit-board)"} ${profile.name}`,
            description: `${meta?.name || profile.providerId} · ${profile.modelId || "no model"}`,
            detail: profile.baseUrl || "default endpoint",
            providerId: profile.providerId,
            profileId: profile.id,
            action: "switch_profile",
          });
        }
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator } as ProfilePickItem);
      }

      items.push({
        label: "$(add) Configure New Provider...",
        description: "Set up a new provider profile",
        providerId: "openai" as ProviderId,
        action: "configure_new",
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a provider profile or configure a new one",
        title: "Agent-X: Provider Configuration",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) return;

      if (selected.action === "switch_profile" && selected.profileId) {
        await switchToProfile(deps, selected.profileId);
        return;
      }

      // Configure new — show provider picker
      const providerItems = PROVIDER_REGISTRY.map((p) => ({
        label: `${p.icon} ${p.name}`,
        description: p.type === "cloud" ? "Cloud" : "Local",
        detail: p.description,
        providerId: p.id,
      }));

      const providerSelected = await vscode.window.showQuickPick(providerItems, {
        placeHolder: "Select provider to configure",
        title: "Agent-X: New Provider — Step 1/5: Provider",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!providerSelected) return;
      providerId = (providerSelected as { providerId: ProviderId }).providerId;
    }

    const meta = getProviderMeta(providerId as ProviderId);
    if (!meta) {
      vscode.window.showErrorMessage(`Agent-X: Unknown provider "${providerId}".`);
      return;
    }

    // Step 2: API Key
    let apiKey: string | undefined;
    if (meta.apiKeyRequired) {
      apiKey = await vscode.window.showInputBox({
        prompt: `Enter API key for ${meta.name}`,
        placeHolder: `Paste your ${meta.envVarName} here`,
        password: true,
        ignoreFocusOut: true,
        title: `Agent-X: Configure ${meta.name} — Step 2/5: API Key`,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "API key is required";
          }
          return undefined;
        },
      });
      if (!apiKey) return;
      apiKey = apiKey.trim();
    }

    // Step 3: Base URL
    let baseUrl: string | undefined;
    if (meta.baseUrlConfigurable) {
      baseUrl = await vscode.window.showInputBox({
        prompt: `Enter base URL for ${meta.name}`,
        placeHolder: meta.defaultBaseUrl || "https://your-resource.openai.azure.com",
        value: meta.defaultBaseUrl,
        ignoreFocusOut: true,
        title: `Agent-X: Configure ${meta.name} — Step 3/5: Base URL`,
        validateInput: (value) => {
          if (value && value.trim().length > 0) {
            try {
              new URL(value);
            } catch {
              return "Must be a valid URL";
            }
          }
          if (meta.id === "azure" && (!value || value.trim().length === 0)) {
            return "Azure OpenAI requires a resource endpoint URL";
          }
          return undefined;
        },
      });
      if (meta.id === "azure" && !baseUrl) return;
      baseUrl = baseUrl?.trim() || meta.defaultBaseUrl;
    }

    // Step 4: Model selection
    let modelId: string | undefined;
    try {
      const models = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Fetching models from ${meta.name}...`,
          cancellable: false,
        },
        async () => {
          const provider = ProviderFactory.create(meta.id, apiKey, baseUrl);
          return await provider.listModels();
        }
      );

      if (models.length > 0) {
        interface ModelPickItem extends vscode.QuickPickItem {
          modelId: string;
        }

        const modelItems: ModelPickItem[] = models.map((m) => ({
          label: m.name || m.id,
          description: formatContextWindow(m.contextWindow),
          detail: m.capabilities?.join(", ") || m.id,
          modelId: m.id,
        }));

        const modelSelected = await vscode.window.showQuickPick(modelItems, {
          placeHolder: "Select default model",
          title: `Agent-X: Configure ${meta.name} — Step 4/5: Model`,
          matchOnDescription: true,
          matchOnDetail: true,
          ignoreFocusOut: true,
        });

        if (!modelSelected) return;
        modelId = (modelSelected as ModelPickItem).modelId;
      }
    } catch {
      // Model fetch failed — fall through to manual input
    }

    if (!modelId) {
      modelId = await vscode.window.showInputBox({
        prompt: "Enter model ID",
        placeHolder: getDefaultModelForProvider(meta.id),
        value: getDefaultModelForProvider(meta.id),
        ignoreFocusOut: true,
        title: `Agent-X: Configure ${meta.name} — Step 4/5: Model (manual)`,
        validateInput: (v) => (!v || v.trim().length === 0 ? "Model ID required" : undefined),
      });
      if (!modelId) return;
    }

    // Step 5: Test connection
    const testResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Testing ${meta.name} connection with ${modelId}...`,
        cancellable: false,
      },
      async () => {
        try {
          const provider = ProviderFactory.create(meta.id, apiKey, baseUrl);
          return await provider.validate();
        } catch {
          return false;
        }
      }
    );

    if (!testResult) {
      const action = await vscode.window.showErrorMessage(
        `Agent-X: Connection test failed for ${meta.name}. Verify credentials and try again.`,
        "Retry",
        "Save Anyway",
        "Cancel"
      );
      if (action === "Retry") {
        await showProviderConfig(deps)(undefined);
        return;
      }
      if (action !== "Save Anyway") return;
    }

    // Save profile
    const profileName = await vscode.window.showInputBox({
      prompt: "Profile name (for identification)",
      placeHolder: `${meta.name} - ${modelId}`,
      value: `${meta.name} - ${modelId}`,
      ignoreFocusOut: true,
      title: `Agent-X: Configure ${meta.name} — Step 5/5: Save`,
    });

    if (!profileName) return;

    const profile: ProviderProfile = {
      id: `${meta.id}-${Date.now()}`,
      providerId: meta.id,
      name: profileName.trim(),
      apiKey,
      baseUrl,
      modelId,
      createdAt: new Date().toISOString(),
    };

    deps.configBridge.saveProviderProfile(profile);
    deps.configBridge.setActiveProvider(meta.id);
    if (apiKey) deps.configBridge.setProviderApiKey(meta.id, apiKey);
    if (baseUrl) deps.configBridge.setProviderBaseUrl(meta.id, baseUrl);
    deps.configBridge.setActiveModel(modelId);
    await deps.configBridge.saveConfig();

    await deps.engineLifecycle.switchProvider(meta.id, apiKey, baseUrl);
    await deps.engineLifecycle.switchModel(modelId);
    deps.statusBarManager.updateProviderIndicator(meta.id);
    deps.statusBarManager.updateModelIndicator(modelId);

    vscode.window.showInformationMessage(
      `Agent-X: Provider profile "${profileName}" saved and activated.`
    );
    deps.outputChannel.appendLine(
      `[Agent-X] Provider profile saved: ${profile.id} (${meta.id}/${modelId})`
    );
  };
}
```

**Acceptance Criteria**:
- 5-step wizard: Provider → API Key → Base URL → Model → Test
- Step titles show progress (e.g., "Step 2/5")
- API key input uses password masking
- Base URL validated as proper URL
- Azure requires both API key and base URL
- Model list fetched from provider API with progress
- Fallback to manual model ID input if fetch fails
- Connection test via `ProviderFactory.create().validate()`
- Failed test offers Retry, Save Anyway, or Cancel
- Profile name input for identification
- Profile saved to config with unique ID

---

### T8.3.2: Profile Switching

```typescript
async function switchToProfile(
  deps: CommandDeps,
  profileId: string
): Promise<void> {
  const profile = deps.configBridge.getProviderProfile(profileId);
  if (!profile) {
    vscode.window.showErrorMessage(`Agent-X: Profile "${profileId}" not found.`);
    return;
  }

  const meta = getProviderMeta(profile.providerId);
  if (!meta) return;

  try {
    deps.configBridge.setActiveProfileId(profileId);
    deps.configBridge.setActiveProvider(profile.providerId);
    if (profile.apiKey) deps.configBridge.setProviderApiKey(profile.providerId, profile.apiKey);
    if (profile.baseUrl) deps.configBridge.setProviderBaseUrl(profile.providerId, profile.baseUrl);
    if (profile.modelId) deps.configBridge.setActiveModel(profile.modelId);
    await deps.configBridge.saveConfig();

    await deps.engineLifecycle.switchProvider(profile.providerId, profile.apiKey, profile.baseUrl);
    if (profile.modelId) {
      await deps.engineLifecycle.switchModel(profile.modelId);
    }

    deps.statusBarManager.updateProviderIndicator(profile.providerId);
    if (profile.modelId) {
      deps.statusBarManager.updateModelIndicator(profile.modelId);
    }

    vscode.window.showInformationMessage(
      `Agent-X: Switched to profile "${profile.name}".`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Agent-X: Profile switch failed — ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getDefaultModelForProvider(providerId: ProviderId): string {
  const defaults: Record<string, string> = {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    google: "gemini-2.5-pro",
    ollama: "llama3",
    lmstudio: "local-model",
    moonshot: "moonshot-v1-128k",
    deepseek: "deepseek-chat",
    groq: "llama-3.3-70b-versatile",
    mistral: "mistral-large-latest",
    together: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    xai: "grok-2-latest",
    fireworks: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    perplexity: "sonar-pro",
    azure: "gpt-4o",
    cohere: "command-r-plus",
  };
  return defaults[providerId] || "default";
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K tokens`;
  return `${tokens} tokens`;
}
```

**Acceptance Criteria**:
- Multiple profiles per provider supported
- Profile list shown in QuickPick with active profile marked
- Switching profile updates: config, engine provider, engine model, status bar
- Profile ID stored for future reference
- Error handling for missing profiles

---

### T8.3.3: Provider Configuration Panel Acceptance Criteria (Summary)

| Criterion | Details |
|-----------|---------|
| 5-step wizard | Provider → API Key → Base URL → Model → Test |
| Step progress shown | Title includes "Step N/5" |
| Password masking | API key input uses `password: true` |
| URL validation | Base URL validated as proper URL |
| Azure special case | Requires both key and URL |
| Model fetch | From provider API with progress |
| Model fallback | Manual input if fetch fails |
| Connection test | `ProviderFactory.create().validate()` |
| Test failure options | Retry / Save Anyway / Cancel |
| Profile naming | User provides profile name |
| Profile persistence | Saved to config |
| Profile switching | QuickPick of existing profiles |
| Multiple profiles | Per-provider profile support |

---

## T8.4: Crew Picker

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/commands/CrewPicker.ts`
**Estimated Effort**: 2 hours

### T8.4.1: Crew QuickPick

```typescript
// packages/vscode/src/commands/CrewPicker.ts

import * as vscode from "vscode";
import type { Crew, CrewEmotion } from "@agentx/shared";
import type { CommandDeps } from "./registerAllCommands";

const EMOTION_ICONS: Record<CrewEmotion, string> = {
  professional: "$(briefcase)",
  friendly: "$(smiley)",
  witty: "$(lightbulb)",
  kind: "$(heart)",
  funny: "$(beaker)",
  arrogant: "$(star-full)",
  flirty: "$(symbol-event)",
  happy: "$(squirrel)",
  sad: "$(cloud)",
  sarcastic: "$(comment-discussion)",
};

const EMOTION_DESCRIPTIONS: Record<CrewEmotion, string> = {
  professional: "Formal and business-like",
  friendly: "Warm and approachable",
  witty: "Clever and sharp",
  kind: "Gentle and caring",
  funny: "Humorous and entertaining",
  arrogant: "Confident and bold",
  flirty: "Playful and charming",
  happy: "Cheerful and upbeat",
  sad: "Melancholic and reflective",
  sarcastic: "Ironic and dry",
};

interface CrewQuickPickItem extends vscode.QuickPickItem {
  crewId: string;
}

export function showCrewPicker(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crews = deps.engineLifecycle.getCrewManager().list();
    const activeCrewId = deps.engineLifecycle.getCrewManager().getActiveId();

    if (crews.length === 0) {
      const action = await vscode.window.showInformationMessage(
        "Agent-X: No crews configured. Would you like to create one?",
        "Create Crew",
        "Cancel"
      );
      if (action === "Create Crew") {
        await vscode.commands.executeCommand("agentx.createCrew");
      }
      return;
    }

    const items: CrewQuickPickItem[] = crews.map((crew) => {
      const isActive = crew.id === activeCrewId;
      const emotionIcon = crew.emotion ? EMOTION_ICONS[crew.emotion] : "$(person)";
      const emotionDesc = crew.emotion ? EMOTION_DESCRIPTIONS[crew.emotion] : "No emotion set";

      return {
        label: isActive
          ? `$(check) ${emotionIcon} ${crew.name}`
          : `${emotionIcon} ${crew.name}`,
        description: emotionDesc,
        detail: crew.systemPrompt
          ? truncate(crew.systemPrompt, 100)
          : "No system prompt",
        crewId: crew.id,
      };
    });

    const separator: CrewQuickPickItem = {
      label: "",
      kind: vscode.QuickPickItemKind.Separator,
      crewId: "",
    };

    const manageItem: CrewQuickPickItem = {
      label: "$(add) Create New Crew...",
      description: "Define a new crew persona",
      crewId: "__create_new__",
    };

    const allItems = [...items, separator, manageItem];

    const selected = await vscode.window.showQuickPick(allItems, {
      placeHolder: `Select crew (${crews.length} available)`,
      matchOnDescription: true,
      matchOnDetail: true,
      title: "Agent-X: Switch Crew",
    });

    if (!selected) return;

    if (selected.crewId === "__create_new__") {
      await vscode.commands.executeCommand("agentx.createCrew");
      return;
    }

    if (selected.crewId === activeCrewId) {
      vscode.window.showInformationMessage(
        `Agent-X: Already using crew "${selected.label.replace("$(check) ", "")}".`
      );
      return;
    }

    try {
      const crewManager = deps.engineLifecycle.getCrewManager();
      const result = crewManager.switch(selected.crewId);

      if (!result) {
        vscode.window.showErrorMessage(
          `Agent-X: Crew "${selected.crewId}" not found.`
        );
        return;
      }

      const agent = deps.engineLifecycle.getAgent();
      if (agent) {
        agent.rebuildSystemPrompt();
      }

      deps.statusBarManager.updateCrewIndicator(result.name, result.emotion);

      vscode.window.showInformationMessage(
        `Agent-X: Switched to crew "${result.name}"${result.emotion ? ` (${result.emotion})` : ""}.`
      );
      deps.outputChannel.appendLine(
        `[Agent-X] Crew switched to ${result.id} (${result.name}).`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Crew switch failed — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

function truncate(text: string, maxLen: number): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + "...";
}
```

**Acceptance Criteria**:
- QuickPick shows all crews from `CrewManager.list()`
- Each item shows: emotion icon, crew name, emotion description, system prompt preview
- Active crew marked with `$(check)` icon
- Emotion icons mapped for all 10 `CrewEmotion` values
- System prompt truncated to 100 chars in detail line
- Separator and "Create New Crew..." option at bottom
- Selecting "Create New Crew..." delegates to `agentx.createCrew`
- Selecting active crew shows info message and returns
- Switch via `CrewManager.switch(id)`
- `agent.rebuildSystemPrompt()` called after switch
- Status bar updated with crew name and emotion
- Output channel logs the switch
- Empty crew list prompts to create one

---

## T8.5: Crew Creator

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/commands/CrewCreator.ts`
**Estimated Effort**: 3 hours

### T8.5.1: Multi-Step Crew Creation Wizard

```typescript
// packages/vscode/src/commands/CrewCreator.ts

import * as vscode from "vscode";
import type { CrewEmotion } from "@agentx/shared";
import type { CommandDeps } from "./registerAllCommands";
import { EMOTION_ICONS, EMOTION_DESCRIPTIONS } from "./CrewPicker";

export function showCrewCreator(deps: CommandDeps): () => Promise<void> {
  return async () => {
    // Step 1: Crew name
    const name = await vscode.window.showInputBox({
      prompt: "Enter crew name",
      placeHolder: "e.g., Code Reviewer, Creative Writer, DevOps Team",
      ignoreFocusOut: true,
      title: "Agent-X: Create Crew — Step 1/4: Name",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return "Name is required";
        if (value.trim().length > 60) return "Name must be 60 characters or less";
        const existing = deps.engineLifecycle.getCrewManager().list();
        if (existing.some((c) => c.name.toLowerCase() === value.trim().toLowerCase())) {
          return "A crew with this name already exists";
        }
        return undefined;
      },
    });

    if (!name) return;
    const trimmedName = name.trim();

    // Step 2: System prompt
    const systemPrompt = await getSystemPromptInput(trimmedName);
    if (systemPrompt === undefined) return;

    // Step 3: Emotion selection
    const emotion = await selectEmotion();

    // Step 4: Preview and confirm
    const confirmed = await previewAndConfirm(trimmedName, systemPrompt, emotion);
    if (!confirmed) return;

    // Save
    try {
      const crewId = generateCrewId(trimmedName);
      const crewManager = deps.engineLifecycle.getCrewManager();
      const newCrew = crewManager.create({
        id: crewId,
        name: trimmedName,
        systemPrompt,
        emotion: emotion || undefined,
      });

      const switchNow = await vscode.window.showInformationMessage(
        `Agent-X: Crew "${trimmedName}" created successfully!`,
        "Switch to This Crew",
        "Keep Current"
      );

      if (switchNow === "Switch to This Crew") {
        crewManager.switch(newCrew.id);
        const agent = deps.engineLifecycle.getAgent();
        if (agent) {
          agent.rebuildSystemPrompt();
        }
        deps.statusBarManager.updateCrewIndicator(newCrew.name, newCrew.emotion);
      }

      deps.outputChannel.appendLine(
        `[Agent-X] Crew created: ${newCrew.id} (${newCrew.name})`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to create crew — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- 4-step wizard: Name → System Prompt → Emotion → Preview
- Step titles show progress
- Name validated: non-empty, max 60 chars, unique
- System prompt collected via editor or input box
- Emotion selected from QuickPick with all 10 options
- Preview shows all settings before confirm
- Crew saved via `CrewManager.create()`
- Option to immediately switch to new crew
- Output channel logs creation

---

### T8.5.2: System Prompt Input

```typescript
async function getSystemPromptInput(crewName: string): Promise<string | undefined> {
  const inputMethod = await vscode.window.showQuickPick(
    [
      {
        label: "$(edit) Write in Editor",
        description: "Opens a temporary file for multi-line editing",
        method: "editor",
      },
      {
        label: "$(terminal) Type Inline",
        description: "Enter prompt directly in input box",
        method: "inline",
      },
      {
        label: "$(file) Use Template",
        description: "Start from a predefined template",
        method: "template",
      },
    ],
    {
      placeHolder: "How would you like to write the system prompt?",
      title: "Agent-X: Create Crew — Step 2/4: System Prompt",
      ignoreFocusOut: true,
    }
  );

  if (!inputMethod) return undefined;

  const method = (inputMethod as { method: string }).method;

  if (method === "editor") {
    return await getSystemPromptViaEditor(crewName);
  }

  if (method === "template") {
    return await getSystemPromptFromTemplate(crewName);
  }

  // Inline input
  return await vscode.window.showInputBox({
    prompt: "Enter system prompt for this crew",
    placeHolder: "You are a specialized AI assistant that...",
    ignoreFocusOut: true,
    title: "Agent-X: Create Crew — Step 2/4: System Prompt",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) return "System prompt is required";
      return undefined;
    },
  });
}

async function getSystemPromptViaEditor(crewName: string): Promise<string | undefined> {
  const templateContent = [
    `# System Prompt for: ${crewName}`,
    ``,
    `# Write your system prompt below. This defines the crew's personality and behavior.`,
    `# Lines starting with # are comments and will be stripped.`,
    `# Save and close this file when done.`,
    ``,
    `You are ${crewName}. `,
    ``,
  ].join("\n");

  const doc = await vscode.workspace.openTextDocument({
    content: templateContent,
    language: "markdown",
  });

  await vscode.window.showTextDocument(doc, {
    preview: false,
    viewColumn: vscode.ViewColumn.Active,
  });

  const confirmed = await vscode.window.showInformationMessage(
    "Edit the system prompt in the editor, then click 'Done' when ready.",
    "Done",
    "Cancel"
  );

  if (confirmed !== "Done") return undefined;

  const text = doc.getText();
  const lines = text.split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();

  if (!lines) {
    vscode.window.showWarningMessage("Agent-X: System prompt is empty.");
    return undefined;
  }

  return lines;
}

async function getSystemPromptFromTemplate(crewName: string): Promise<string | undefined> {
  const templates = [
    {
      label: "$(code) Code Expert",
      prompt: `You are ${crewName}, an expert software engineer. You write clean, efficient, well-documented code. You follow best practices and design patterns. When reviewing code, you are thorough and constructive.`,
    },
    {
      label: "$(book) Creative Writer",
      prompt: `You are ${crewName}, a creative writing assistant. You help with storytelling, character development, dialogue, and narrative structure. You are imaginative and encouraging.`,
    },
    {
      label: "$(shield) Security Analyst",
      prompt: `You are ${crewName}, a cybersecurity specialist. You identify vulnerabilities, suggest secure coding practices, and review code for security issues. You are meticulous and risk-aware.`,
    },
    {
      label: "$(graph) Data Scientist",
      prompt: `You are ${crewName}, a data science expert. You help with data analysis, visualization, machine learning models, and statistical reasoning. You explain complex concepts clearly.`,
    },
    {
      label: "$(tools) DevOps Engineer",
      prompt: `You are ${crewName}, a DevOps and infrastructure specialist. You help with CI/CD pipelines, containerization, cloud deployment, monitoring, and system reliability.`,
    },
    {
      label: "$(pencil) Custom (blank)",
      prompt: `You are ${crewName}. `,
    },
  ];

  const selected = await vscode.window.showQuickPick(templates, {
    placeHolder: "Select a template to start from",
    title: "Agent-X: Create Crew — Step 2/4: Template",
    ignoreFocusOut: true,
  });

  if (!selected) return undefined;

  const templatePrompt = (selected as { prompt: string }).prompt;

  // Allow editing the template
  return await vscode.window.showInputBox({
    prompt: "Edit the system prompt (or press Enter to accept)",
    value: templatePrompt,
    ignoreFocusOut: true,
    title: "Agent-X: Create Crew — Step 2/4: Edit Template",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) return "System prompt is required";
      return undefined;
    },
  });
}
```

**Acceptance Criteria**:
- Three input methods: Editor, Inline, Template
- Editor method: opens temp markdown file with template comments
- Editor method: strips comment lines, trims result
- Template method: 6 predefined templates + blank option
- Template method: allows editing after selection
- Inline method: simple input box
- All methods validate non-empty result

---

### T8.5.3: Emotion Selection

```typescript
async function selectEmotion(): Promise<CrewEmotion | null> {
  interface EmotionItem extends vscode.QuickPickItem {
    emotion: CrewEmotion | null;
  }

  const items: EmotionItem[] = [
    {
      label: "$(circle-slash) No Emotion",
      description: "Neutral, no personality overlay",
      emotion: null,
    },
    ...Object.entries(EMOTION_ICONS).map(([emotion, icon]) => ({
      label: `${icon} ${emotion.charAt(0).toUpperCase() + emotion.slice(1)}`,
      description: EMOTION_DESCRIPTIONS[emotion as CrewEmotion],
      emotion: emotion as CrewEmotion,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select crew emotion/personality",
    title: "Agent-X: Create Crew — Step 3/4: Emotion",
    ignoreFocusOut: true,
  });

  if (!selected) return null;
  return (selected as EmotionItem).emotion;
}
```

**Acceptance Criteria**:
- All 10 `CrewEmotion` values shown with icons and descriptions
- "No Emotion" option at top for neutral crews
- Returns `null` for no emotion, `CrewEmotion` value otherwise
- Icons match those used in CrewPicker

---

### T8.5.4: Preview and Confirm

```typescript
async function previewAndConfirm(
  name: string,
  systemPrompt: string,
  emotion: CrewEmotion | null
): Promise<boolean> {
  const emotionLabel = emotion
    ? `${EMOTION_ICONS[emotion]} ${emotion.charAt(0).toUpperCase() + emotion.slice(1)}`
    : "None";

  const previewContent = [
    `Crew Preview`,
    `═══════════════════════════════════════`,
    ``,
    `Name:     ${name}`,
    `Emotion:  ${emotionLabel}`,
    `Prompt:   ${systemPrompt.length} characters`,
    ``,
    `───────────────────────────────────────`,
    `System Prompt:`,
    `───────────────────────────────────────`,
    ``,
    systemPrompt,
  ].join("\n");

  const doc = await vscode.workspace.openTextDocument({
    content: previewContent,
    language: "plaintext",
  });

  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });

  const choice = await vscode.window.showInformationMessage(
    `Create crew "${name}" with ${emotionLabel} emotion?`,
    "Create",
    "Edit Prompt",
    "Cancel"
  );

  if (choice === "Edit Prompt") {
    const newPrompt = await vscode.window.showInputBox({
      prompt: "Edit system prompt",
      value: systemPrompt,
      ignoreFocusOut: true,
      validateInput: (v) => (!v || v.trim().length === 0 ? "Required" : undefined),
    });
    if (newPrompt) {
      return previewAndConfirm(name, newPrompt, emotion);
    }
    return false;
  }

  return choice === "Create";
}

function generateCrewId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${Date.now().toString(36)}`;
}
```

**Acceptance Criteria**:
- Preview document shown beside editor
- Shows name, emotion, prompt length, and full system prompt
- Three options: Create, Edit Prompt, Cancel
- "Edit Prompt" re-prompts and re-previews recursively
- "Create" returns true, "Cancel" returns false
- Crew ID generated from slugified name + timestamp

---

### T8.5.5: Crew Creator Acceptance Criteria (Summary)

| Criterion | Details |
|-----------|---------|
| 4-step wizard | Name → System Prompt → Emotion → Preview |
| Name validation | Non-empty, max 60 chars, unique |
| System prompt methods | Editor, Inline, Template |
| Editor method | Opens temp file, strips comments |
| Template method | 5 templates + blank |
| Emotion selection | All 10 CrewEmotion values + None |
| Preview | Document with full details |
| Edit loop | Can re-edit prompt from preview |
| Save | `CrewManager.create()` |
| Immediate switch | Option to switch to new crew |
| ID generation | Slugified name + timestamp |

---

## T8.6: Crew Editor

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/commands/CrewEditor.ts`
**Estimated Effort**: 3 hours

### T8.6.1: Crew Selection and Edit Menu

```typescript
// packages/vscode/src/commands/CrewEditor.ts

import * as vscode from "vscode";
import type { CrewEmotion } from "@agentx/shared";
import type { CommandDeps } from "./registerAllCommands";
import { EMOTION_ICONS, EMOTION_DESCRIPTIONS } from "./CrewPicker";

interface CrewEditItem extends vscode.QuickPickItem {
  crewId: string;
}

export function showCrewEditor(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crewManager = deps.engineLifecycle.getCrewManager();
    const crews = crewManager.list();

    if (crews.length === 0) {
      vscode.window.showInformationMessage("Agent-X: No crews to edit.");
      return;
    }

    const activeCrewId = crewManager.getActiveId();

    const items: CrewEditItem[] = crews.map((crew) => {
      const emotionIcon = crew.emotion ? EMOTION_ICONS[crew.emotion] : "$(person)";
      const isActive = crew.id === activeCrewId;
      return {
        label: `${emotionIcon} ${crew.name}`,
        description: crew.emotion ? EMOTION_DESCRIPTIONS[crew.emotion] : "No emotion",
        detail: isActive ? "$(check) Active crew" : `Updated: ${new Date(crew.updatedAt).toLocaleDateString()}`,
        crewId: crew.id,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select crew to edit",
      title: "Agent-X: Edit Crew",
      matchOnDescription: true,
    });

    if (!selected) return;

    const crew = crewManager.get(selected.crewId);
    if (!crew) {
      vscode.window.showErrorMessage("Agent-X: Crew not found.");
      return;
    }

    // Show edit action menu
    await showEditActionMenu(deps, crew);
  };
}
```

**Acceptance Criteria**:
- QuickPick lists all crews with emotion icons and update dates
- Active crew indicated with check mark
- Empty list handled with info message
- Selected crew passed to edit action menu

---

### T8.6.2: Edit Action Menu

```typescript
async function showEditActionMenu(
  deps: CommandDeps,
  crew: { id: string; name: string; systemPrompt: string; emotion?: CrewEmotion; isDefault: boolean }
): Promise<void> {
  interface ActionItem extends vscode.QuickPickItem {
    action: "edit_name" | "edit_prompt" | "edit_emotion" | "open_file" | "delete";
  }

  const items: ActionItem[] = [
    {
      label: "$(edit) Edit Name",
      description: crew.name,
      action: "edit_name",
    },
    {
      label: "$(file-text) Edit System Prompt",
      description: `${crew.systemPrompt.length} characters`,
      action: "edit_prompt",
    },
    {
      label: "$(smiley) Edit Emotion",
      description: crew.emotion || "None",
      action: "edit_emotion",
    },
    {
      label: "$(go-to-file) Open Crew File in Editor",
      description: "Edit raw JSON directly",
      action: "open_file",
    },
  ];

  if (!crew.isDefault) {
    items.push({
      label: "$(trash) Delete Crew",
      description: "Permanently remove this crew",
      action: "delete",
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Editing: ${crew.name}`,
    title: `Agent-X: Edit "${crew.name}"`,
  });

  if (!selected) return;

  const action = (selected as ActionItem).action;

  switch (action) {
    case "edit_name":
      await editCrewName(deps, crew);
      break;
    case "edit_prompt":
      await editCrewPrompt(deps, crew);
      break;
    case "edit_emotion":
      await editCrewEmotion(deps, crew);
      break;
    case "open_file":
      await openCrewFile(deps, crew.id);
      break;
    case "delete":
      await deleteCrew(deps, crew);
      break;
  }
}
```

**Acceptance Criteria**:
- Action menu shows: Edit Name, Edit Prompt, Edit Emotion, Open File, Delete
- Delete option hidden for default crew
- Each action shows current value as description
- Routes to appropriate edit function

---

### T8.6.3: Edit Name

```typescript
async function editCrewName(
  deps: CommandDeps,
  crew: { id: string; name: string }
): Promise<void> {
  const newName = await vscode.window.showInputBox({
    prompt: "Enter new crew name",
    value: crew.name,
    ignoreFocusOut: true,
    title: `Agent-X: Rename "${crew.name}"`,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) return "Name is required";
      if (value.trim().length > 60) return "Name must be 60 characters or less";
      return undefined;
    },
  });

  if (!newName || newName.trim() === crew.name) return;

  const crewManager = deps.engineLifecycle.getCrewManager();
  const updated = crewManager.update(crew.id, { name: newName.trim() });

  if (!updated) {
    vscode.window.showErrorMessage("Agent-X: Failed to update crew name.");
    return;
  }

  if (crewManager.getActiveId() === crew.id) {
    deps.statusBarManager.updateCrewIndicator(updated.name, updated.emotion);
  }

  vscode.window.showInformationMessage(
    `Agent-X: Crew renamed to "${updated.name}".`
  );
}
```

---

### T8.6.4: Edit System Prompt

```typescript
async function editCrewPrompt(
  deps: CommandDeps,
  crew: { id: string; name: string; systemPrompt: string }
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: [
      `# System Prompt for: ${crew.name}`,
      `# Edit below. Lines starting with # are comments.`,
      `# Save this file, then click "Done" in the notification.`,
      ``,
      crew.systemPrompt,
    ].join("\n"),
    language: "markdown",
  });

  await vscode.window.showTextDocument(doc, {
    preview: false,
    viewColumn: vscode.ViewColumn.Active,
  });

  const confirmed = await vscode.window.showInformationMessage(
    `Edit the system prompt for "${crew.name}", then click Done.`,
    "Done",
    "Cancel"
  );

  if (confirmed !== "Done") return;

  const newPrompt = doc.getText()
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();

  if (!newPrompt) {
    vscode.window.showWarningMessage("Agent-X: System prompt cannot be empty.");
    return;
  }

  const crewManager = deps.engineLifecycle.getCrewManager();
  const updated = crewManager.update(crew.id, { systemPrompt: newPrompt });

  if (!updated) {
    vscode.window.showErrorMessage("Agent-X: Failed to update system prompt.");
    return;
  }

  if (crewManager.getActiveId() === crew.id) {
    const agent = deps.engineLifecycle.getAgent();
    if (agent) {
      agent.rebuildSystemPrompt();
    }
  }

  vscode.window.showInformationMessage(
    `Agent-X: System prompt updated for "${crew.name}".`
  );
}
```

---

### T8.6.5: Edit Emotion

```typescript
async function editCrewEmotion(
  deps: CommandDeps,
  crew: { id: string; name: string; emotion?: CrewEmotion }
): Promise<void> {
  interface EmotionItem extends vscode.QuickPickItem {
    emotion: CrewEmotion | null;
  }

  const items: EmotionItem[] = [
    {
      label: "$(circle-slash) No Emotion",
      description: "Neutral personality",
      emotion: null,
    },
    ...Object.entries(EMOTION_ICONS).map(([emotion, icon]) => ({
      label: `${icon} ${emotion.charAt(0).toUpperCase() + emotion.slice(1)}`,
      description: EMOTION_DESCRIPTIONS[emotion as CrewEmotion],
      emotion: emotion as CrewEmotion,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select emotion for "${crew.name}"`,
    title: `Agent-X: Edit Emotion — ${crew.name}`,
    ignoreFocusOut: true,
  });

  if (!selected) return;

  const newEmotion = (selected as EmotionItem).emotion;
  const crewManager = deps.engineLifecycle.getCrewManager();
  const updated = crewManager.update(crew.id, { emotion: newEmotion ?? undefined });

  if (!updated) {
    vscode.window.showErrorMessage("Agent-X: Failed to update emotion.");
    return;
  }

  if (crewManager.getActiveId() === crew.id) {
    deps.statusBarManager.updateCrewIndicator(updated.name, updated.emotion);
    const agent = deps.engineLifecycle.getAgent();
    if (agent) {
      agent.rebuildSystemPrompt();
    }
  }

  vscode.window.showInformationMessage(
    `Agent-X: Emotion updated for "${crew.name}".`
  );
}
```

---

### T8.6.6: Open Crew File

```typescript
async function openCrewFile(
  deps: CommandDeps,
  crewId: string
): Promise<void> {
  const crewFilePath = deps.engineLifecycle.getCrewFilePath(crewId);

  if (!crewFilePath) {
    vscode.window.showErrorMessage("Agent-X: Crew file path not available.");
    return;
  }

  const uri = vscode.Uri.file(crewFilePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}
```

---

### T8.6.7: Delete Crew

```typescript
async function deleteCrew(
  deps: CommandDeps,
  crew: { id: string; name: string; isDefault: boolean }
): Promise<void> {
  if (crew.isDefault) {
    vscode.window.showWarningMessage(
      "Agent-X: Cannot delete the default crew."
    );
    return;
  }

  const crewManager = deps.engineLifecycle.getCrewManager();
  const isActive = crewManager.getActiveId() === crew.id;

  if (isActive) {
    vscode.window.showWarningMessage(
      "Agent-X: Cannot delete the currently active crew. Switch to a different crew first."
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete crew "${crew.name}"? This cannot be undone.`,
    { modal: true },
    "Delete"
  );

  if (confirm !== "Delete") return;

  const deleted = crewManager.delete(crew.id);

  if (!deleted) {
    vscode.window.showErrorMessage(
      "Agent-X: Failed to delete crew. It may be the active or only crew."
    );
    return;
  }

  vscode.window.showInformationMessage(
    `Agent-X: Crew "${crew.name}" deleted.`
  );
  deps.outputChannel.appendLine(`[Agent-X] Crew deleted: ${crew.id} (${crew.name})`);
}
```

**Acceptance Criteria**:
- Default crew cannot be deleted (guard)
- Active crew cannot be deleted (guard — must switch first)
- Modal confirmation with "cannot be undone" warning
- `CrewManager.delete(id)` called
- Output channel logs deletion
- Error handling for failed deletion

---

### T8.6.8: Crew Editor Acceptance Criteria (Summary)

| Criterion | Details |
|-----------|---------|
| Crew selection | QuickPick with all crews |
| Edit name | InputBox with validation |
| Edit prompt | Opens in editor, strips comments |
| Edit emotion | QuickPick with all 10 emotions |
| Open file | Opens raw JSON in VS Code |
| Delete | Modal confirmation, guards for default/active |
| Active crew updates | Status bar + `rebuildSystemPrompt()` on active crew edits |
| Persistence | All changes via `CrewManager.update()` |

---

## T8.7: Provider/Model Status Bar Integration

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/statusbar/ProviderModelStatusBar.ts`
**Estimated Effort**: 2 hours

### T8.7.1: Enhanced Status Bar Methods

These methods extend the `StatusBarManager` from Phase 3 with provider/model-specific features.

```typescript
// packages/vscode/src/statusbar/ProviderModelStatusBar.ts

import * as vscode from "vscode";
import type { ProviderId, CrewEmotion } from "@agentx/shared";
import { getProviderMeta, PROVIDER_REGISTRY } from "../commands/ProviderPicker";

export interface ProviderModelStatusBarItems {
  providerItem: vscode.StatusBarItem;
  modelItem: vscode.StatusBarItem;
  crewItem: vscode.StatusBarItem;
  modelTrialItem: vscode.StatusBarItem;
}

export function createProviderModelStatusBar(): ProviderModelStatusBarItems {
  const providerItem = vscode.window.createStatusBarItem(
    "agentx.provider",
    vscode.StatusBarAlignment.Left,
    100
  );
  providerItem.name = "Agent-X Provider";
  providerItem.command = "agentx.switchProvider";
  providerItem.tooltip = new vscode.MarkdownString(
    "**Agent-X Provider**\n\nClick to switch AI provider\n\n---\n*Current: none*"
  );

  const modelItem = vscode.window.createStatusBarItem(
    "agentx.model",
    vscode.StatusBarAlignment.Left,
    99
  );
  modelItem.name = "Agent-X Model";
  modelItem.command = "agentx.switchModel";
  modelItem.tooltip = new vscode.MarkdownString(
    "**Agent-X Model**\n\nClick to switch model\n\n---\n*Current: none*"
  );

  const crewItem = vscode.window.createStatusBarItem(
    "agentx.crew",
    vscode.StatusBarAlignment.Left,
    95
  );
  crewItem.name = "Agent-X Crew";
  crewItem.command = "agentx.switchCrew";
  crewItem.tooltip = new vscode.MarkdownString(
    "**Agent-X Crew**\n\nClick to switch crew/profile"
  );

  const modelTrialItem = vscode.window.createStatusBarItem(
    "agentx.modelTrial",
    vscode.StatusBarAlignment.Left,
    98
  );
  modelTrialItem.name = "Agent-X Model Trial";
  modelTrialItem.text = "$(sync~spin) Testing model...";
  modelTrialItem.tooltip = "Pre-flight check in progress";
  modelTrialItem.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.prominentBackground"
  );

  return { providerItem, modelItem, crewItem, modelTrialItem };
}

export function updateProviderStatusBar(
  item: vscode.StatusBarItem,
  providerId: ProviderId | string,
  sessionId?: string
): void {
  const meta = getProviderMeta(providerId as ProviderId);
  const icon = meta?.icon || "$(circuit-board)";
  const name = meta?.name || String(providerId);
  const typeLabel = meta?.type === "local" ? " (local)" : "";

  item.text = `${icon} ${name}${typeLabel}`;

  const tooltipLines = [
    `**Agent-X Provider**`,
    ``,
    `Provider: **${name}** (${providerId})`,
    `Type: ${meta?.type || "unknown"}`,
    `API Key: ${meta?.apiKeyRequired ? "Required" : "Not required"}`,
  ];
  if (sessionId) {
    tooltipLines.push(`Session: \`${sessionId.slice(0, 12)}\``);
  }
  tooltipLines.push(``, `---`, `*Click to switch provider*`);

  item.tooltip = new vscode.MarkdownString(tooltipLines.join("\n"));
  item.show();
}

export function updateModelStatusBar(
  item: vscode.StatusBarItem,
  modelId: string,
  contextWindow?: number
): void {
  const shortName = modelId.length > 25 ? modelId.slice(0, 22) + "..." : modelId;
  const ctxLabel = contextWindow ? ` (${formatCtx(contextWindow)})` : "";

  item.text = `$(symbol-misc) ${shortName}${ctxLabel}`;

  const tooltipLines = [
    `**Agent-X Model**`,
    ``,
    `Model: **${modelId}**`,
  ];
  if (contextWindow) {
    tooltipLines.push(`Context Window: ${contextWindow.toLocaleString()} tokens`);
  }
  tooltipLines.push(``, `---`, `*Click to switch model*`);

  item.tooltip = new vscode.MarkdownString(tooltipLines.join("\n"));
  item.show();
}

export function updateCrewStatusBar(
  item: vscode.StatusBarItem,
  crewName: string,
  emotion?: CrewEmotion
): void {
  const emotionIcons: Record<string, string> = {
    professional: "$(briefcase)",
    friendly: "$(smiley)",
    witty: "$(lightbulb)",
    kind: "$(heart)",
    funny: "$(beaker)",
    arrogant: "$(star-full)",
    flirty: "$(symbol-event)",
    happy: "$(squirrel)",
    sad: "$(cloud)",
    sarcastic: "$(comment-discussion)",
  };

  const icon = emotion ? emotionIcons[emotion] || "$(organization)" : "$(organization)";
  const emotionLabel = emotion ? ` (${emotion})` : "";

  item.text = `${icon} ${crewName}`;
  item.tooltip = new vscode.MarkdownString(
    [
      `**Agent-X Crew**`,
      ``,
      `Crew: **${crewName}**${emotionLabel}`,
      ``,
      `---`,
      `*Click to switch crew*`,
    ].join("\n")
  );
  item.show();
}

export function showModelTrialIndicator(item: vscode.StatusBarItem, modelId: string): void {
  item.text = `$(sync~spin) Testing ${modelId.length > 15 ? modelId.slice(0, 12) + "..." : modelId}...`;
  item.tooltip = `Pre-flight check for ${modelId}`;
  item.show();
}

export function hideModelTrialIndicator(item: vscode.StatusBarItem): void {
  item.hide();
}

export function showProviderError(
  item: vscode.StatusBarItem,
  providerId: string,
  errorMsg: string
): void {
  item.text = `$(error) ${providerId}`;
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  item.tooltip = new vscode.MarkdownString(
    `**Provider Error**\n\n${providerId}: ${errorMsg}\n\n---\n*Click to reconfigure*`
  );
  item.command = "agentx.configureProvider";
  item.show();
}

export function clearProviderError(item: vscode.StatusBarItem): void {
  item.backgroundColor = undefined;
  item.command = "agentx.switchProvider";
}

function formatCtx(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}
```

**Acceptance Criteria**:
- Provider item: shows icon + name, rich Markdown tooltip with provider details and session ID
- Model item: shows icon + truncated name + context window, rich tooltip
- Crew item: shows emotion icon + name, tooltip with emotion
- Model trial: spinning indicator shown during trial, hidden after
- Provider error: red background, error icon, click to reconfigure
- Error cleared on successful switch
- All tooltips use `MarkdownString` for rich formatting
- Click handlers wired to appropriate picker commands

---

### T8.7.2: Status Bar Integration with Extension Activation

The status bar items from T8.7.1 are wired into `extension.ts` activate() alongside the existing `StatusBarManager`:

```typescript
// In extension.ts activate(), add after StatusBarManager initialization:

import {
  createProviderModelStatusBar,
  updateProviderStatusBar,
  updateModelStatusBar,
  updateCrewStatusBar,
  showModelTrialIndicator,
  hideModelTrialIndicator,
  showProviderError,
  clearProviderError,
} from "./statusbar/ProviderModelStatusBar";

const pmStatusBar = createProviderModelStatusBar();
context.subscriptions.push(pmStatusBar.providerItem);
context.subscriptions.push(pmStatusBar.modelItem);
context.subscriptions.push(pmStatusBar.crewItem);
context.subscriptions.push(pmStatusBar.modelTrialItem);

// Wire event bridge to enhanced status bar:
eventBridge.onProviderChange((provider) => {
  clearProviderError(pmStatusBar.providerItem);
  updateProviderStatusBar(
    pmStatusBar.providerItem,
    provider,
    engineLifecycle.getCurrentSessionId() || undefined
  );
});

eventBridge.onModelChange((model) => {
  updateModelStatusBar(pmStatusBar.modelItem, model.id, model.contextWindow);
});
```

**Acceptance Criteria**:
- Enhanced status bar items created and registered as disposables
- Event bridge callbacks wired to update provider/model/crew indicators
- Provider error state cleared on successful change
- Session ID included in provider tooltip

---

### T8.7.3: Status Bar Integration Acceptance Criteria (Summary)

| Criterion | Details |
|-----------|---------|
| Provider indicator | Icon + name + type, rich tooltip |
| Model indicator | Icon + name + context window, rich tooltip |
| Crew indicator | Emotion icon + name, tooltip with emotion |
| Model trial | Spinning indicator during trial |
| Provider error | Red background, error icon, click to reconfigure |
| Click handlers | Provider → switchProvider, Model → switchModel, Crew → switchCrew |
| Tooltips | MarkdownString with full details |
| Disposables | All items pushed to context.subscriptions |

---

## T8.8: Configuration Sync

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/config/ConfigSync.ts`
**Estimated Effort**: 3 hours

### T8.8.1: Bidirectional Config Sync Manager

```typescript
// packages/vscode/src/config/ConfigSync.ts

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getConfigDir } from "@agentx/engine/config/paths";
import type { CommandDeps } from "../commands/registerAllCommands";

const DEBOUNCE_MS = 1000;
const SYNC_LOCK_KEY = "agentx.configSync.lock";

export class ConfigSync implements vscode.Disposable {
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private isSyncing = false;
  private lastKnownHash: string | null = null;
  private configFilePath: string;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private deps: CommandDeps
  ) {
    this.configFilePath = path.join(getConfigDir(), "config.json");
    this.setupFileWatcher();
    this.setupSettingsWatcher();
    this.computeCurrentHash();
  }

  private setupFileWatcher(): void {
    const configDir = getConfigDir();
    const pattern = new vscode.RelativePattern(configDir, "config.json");
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.fileWatcher.onDidChange(() => this.onExternalChange());
    this.fileWatcher.onDidCreate(() => this.onExternalChange());
    this.fileWatcher.onDidDelete(() => this.onExternalDelete());

    this.disposables.push(this.fileWatcher);
  }

  private setupSettingsWatcher(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (this.isSyncing) return;

        if (event.affectsConfiguration("agentx.provider")) {
          this.onVSCodeSettingsChanged("provider");
        }
        if (event.affectsConfiguration("agentx.model")) {
          this.onVSCodeSettingsChanged("model");
        }
        if (event.affectsConfiguration("agentx.crew")) {
          this.onVSCodeSettingsChanged("crew");
        }
      })
    );
  }

  private onExternalChange(): void {
    if (this.isSyncing) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const newHash = this.computeFileHash();
      if (newHash === this.lastKnownHash) return;

      this.lastKnownHash = newHash;
      await this.reloadFromExternal();
    }, DEBOUNCE_MS);
  }

  private async onExternalDelete(): Promise<void> {
    vscode.window.showWarningMessage(
      "Agent-X: Config file was deleted externally. Some settings may be lost."
    );
    this.lastKnownHash = null;
  }

  private async reloadFromExternal(): Promise<void> {
    this.isSyncing = true;

    try {
      await this.deps.configBridge.reloadFromDisk();

      const config = this.deps.configBridge.getConfig();
      const providerId = (config as Record<string, unknown>)?.provider as Record<string, unknown> | undefined;
      const activeProvider = providerId?.activeProvider as string | undefined;
      const activeModel = providerId?.activeModel as string | undefined;

      const currentProvider = this.deps.configBridge.getActiveProvider();
      const currentModel = this.deps.configBridge.getActiveModel();

      const providerChanged = activeProvider && activeProvider !== currentProvider;
      const modelChanged = activeModel && activeModel !== currentModel;

      if (providerChanged) {
        this.deps.statusBarManager.updateProviderIndicator(activeProvider!);

        if (this.deps.engineLifecycle.hasActiveAgent()) {
          const needsRestart = await vscode.window.showWarningMessage(
            `Agent-X: Provider changed to "${activeProvider}" externally. Restart engine to apply?`,
            "Restart",
            "Later"
          );

          if (needsRestart === "Restart") {
            await this.deps.engineLifecycle.disposeCurrentAgent();
            await this.deps.engineLifecycle.createAgent();
          }
        }
      }

      if (modelChanged) {
        this.deps.statusBarManager.updateModelIndicator(activeModel!);

        if (this.deps.engineLifecycle.hasActiveAgent() && !providerChanged) {
          await this.deps.engineLifecycle.switchModel(activeModel!);
        }
      }

      this.deps.statusBarManager.updateCrewIndicator(
        this.deps.configBridge.getActiveCrewName()
      );

      this.syncToVSCodeSettings();

      this.deps.outputChannel.appendLine(
        `[Agent-X] Config reloaded from disk (provider: ${activeProvider}, model: ${activeModel})`
      );
    } catch (error) {
      vscode.window.showWarningMessage(
        `Agent-X: External config reload failed — ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.isSyncing = false;
    }
  }

  private async onVSCodeSettingsChanged(key: string): Promise<void> {
    this.isSyncing = true;

    try {
      const config = vscode.workspace.getConfiguration("agentx");

      switch (key) {
        case "provider": {
          const provider = config.get<string>("provider");
          if (provider) {
            this.deps.configBridge.setActiveProvider(provider);
            await this.deps.configBridge.saveConfig();
            await this.deps.engineLifecycle.switchProvider(provider);
            this.deps.statusBarManager.updateProviderIndicator(provider);
          }
          break;
        }
        case "model": {
          const model = config.get<string>("model");
          if (model) {
            this.deps.configBridge.setActiveModel(model);
            await this.deps.configBridge.saveConfig();
            await this.deps.engineLifecycle.switchModel(model);
            this.deps.statusBarManager.updateModelIndicator(model);
          }
          break;
        }
        case "crew": {
          const crew = config.get<string>("crew");
          if (crew) {
            const crewManager = this.deps.engineLifecycle.getCrewManager();
            crewManager.switch(crew);
            const agent = this.deps.engineLifecycle.getAgent();
            if (agent) agent.rebuildSystemPrompt();
            this.deps.statusBarManager.updateCrewIndicator(
              this.deps.configBridge.getActiveCrewName()
            );
          }
          break;
        }
      }

      this.lastKnownHash = this.computeFileHash();

      this.deps.outputChannel.appendLine(
        `[Agent-X] VS Code settings change synced: ${key}`
      );
    } catch (error) {
      this.deps.outputChannel.appendLine(
        `[Agent-X] Settings sync error: ${error}`
      );
    } finally {
      this.isSyncing = false;
    }
  }

  private syncToVSCodeSettings(): void {
    const config = vscode.workspace.getConfiguration("agentx");
    const engineConfig = this.deps.configBridge.getConfig() as Record<string, unknown>;
    const providerSection = engineConfig?.provider as Record<string, unknown> | undefined;

    if (providerSection) {
      const activeProvider = providerSection.activeProvider as string | undefined;
      const activeModel = providerSection.activeModel as string | undefined;

      if (activeProvider && config.get("provider") !== activeProvider) {
        config.update("provider", activeProvider, vscode.ConfigurationTarget.Global);
      }
      if (activeModel && config.get("model") !== activeModel) {
        config.update("model", activeModel, vscode.ConfigurationTarget.Global);
      }
    }
  }

  private computeCurrentHash(): void {
    this.lastKnownHash = this.computeFileHash();
  }

  private computeFileHash(): string | null {
    try {
      if (!fs.existsSync(this.configFilePath)) return null;
      const content = fs.readFileSync(this.configFilePath, "utf-8");
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return String(hash);
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
```

**Acceptance Criteria**:
- File watcher on `~/.config/agentx/config.json` for change, create, delete
- 1-second debounce on external changes to avoid rapid reloads
- Hash-based change detection to avoid processing unchanged files
- External change: reload config, detect provider/model changes, prompt for engine restart
- VS Code settings change: update config bridge, save to disk, update engine
- Bidirectional sync: external changes update VS Code settings, VS Code changes update config file
- `isSyncing` flag prevents infinite loops between watchers
- Delete event shows warning
- Output channel logs all sync operations
- Proper disposal of watchers and timers

---

### T8.8.2: Config Sync Registration

```typescript
// In extension.ts activate(), add:

import { ConfigSync } from "./config/ConfigSync";

const configSync = new ConfigSync({
  engineLifecycle,
  configBridge,
  eventBridge,
  statusBarManager,
  contextKeyManager,
  outputChannel,
});
context.subscriptions.push(configSync);
```

**Acceptance Criteria**:
- ConfigSync instantiated with all required deps
- Registered as disposable in extension context
- Active for the lifetime of the extension

---

### T8.8.3: Configuration Sync Acceptance Criteria (Summary)

| Direction | Trigger | Action |
|-----------|---------|--------|
| External → VS Code | CLI/TUI modifies `config.json` | File watcher detects, debounces, reloads, updates status bar, prompts restart if provider changed |
| VS Code → External | User changes `agentx.*` in Settings | Settings watcher detects, updates config bridge, saves to disk, updates engine |
| Loop prevention | `isSyncing` flag | Prevents watchers from triggering each other |
| Hash check | `computeFileHash()` | Avoids processing unchanged files |
| Delete handling | File deleted externally | Warning shown to user |
| Restart prompt | Provider changed externally | Modal asking to restart engine |

---

## T8.9: Verification

**Status**: ⬜ Not Started
**Estimated Effort**: 3 hours

### T8.9.1: Provider Switching Verification

| Test | Steps | Expected Result |
|------|-------|----------------|
| OpenAI switch | Command palette → Switch Provider → OpenAI → Enter API key | Provider switches, status bar updates, models listed |
| Anthropic switch | Switch to Anthropic → Enter API key | Provider switches, Claude models available |
| Ollama switch | Switch to Ollama → Enter base URL | Provider switches, local models listed |
| LM Studio switch | Switch to LM Studio → Enter base URL | Provider switches, local models listed |
| Azure switch | Switch to Azure → Enter API key + resource URL | Provider switches with custom endpoint |
| DeepSeek switch | Switch to DeepSeek → Enter API key | Provider switches, DeepSeek models listed |
| Groq switch | Switch to Groq → Enter API key | Provider switches, fast inference models |
| Invalid API key | Enter wrong key for any cloud provider | Validation fails, retry option shown |
| Unreachable local | Enter wrong URL for Ollama | Validation fails, retry option shown |
| Same provider | Select already-active provider | Info message "Already using..." |
| All 15 providers | Iterate through all providers | Each shows correct icon, type, key requirement |

### T8.9.2: Model Switching Verification

| Test | Steps | Expected Result |
|------|-------|----------------|
| List models | Switch Model command | Progress shown, models listed with context windows |
| Active model marked | Open model picker | Current model has `$(check)` icon |
| Grounded model | Try a model that fails trial | `$(warning)` icon on subsequent picker opens |
| Trial success | Select a valid model | Trial progress shown, model switches |
| Trial failure | Select an invalid model | Warning shown, option to pick another |
| Context window | Switch to model with different context | Status bar shows new context window |
| Search/filter | Type in model picker | List filtered by search term |
| Empty model list | Provider with no models | Warning with option to configure provider |
| Config persistence | Switch model, restart VS Code | Model persists across restarts |

### T8.9.3: Crew Switching Verification

| Test | Steps | Expected Result |
|------|-------|----------------|
| List crews | Switch Crew command | All crews shown with emotion icons |
| Active crew marked | Open crew picker | Current crew has `$(check)` icon |
| Switch crew | Select different crew | Crew switches, system prompt rebuilt |
| Status bar update | Switch crew | Crew indicator shows new name/emotion |
| Empty crew list | No crews configured | Prompt to create one |
| Create new from picker | Click "Create New Crew..." | Delegates to crew creator |
| Same crew | Select active crew | Info message "Already using..." |

### T8.9.4: Crew Creation Verification

| Test | Steps | Expected Result |
|------|-------|----------------|
| Full wizard | Name → Prompt (inline) → Emotion → Preview → Create | Crew created, option to switch |
| Editor prompt | Choose "Write in Editor" | Temp file opens, comments stripped on save |
| Template prompt | Choose "Use Template" → Select template | Template editable, saved |
| Duplicate name | Enter existing crew name | Validation error shown |
| No emotion | Select "No Emotion" | Crew created without emotion |
| All emotions | Create crew for each of 10 emotions | Each emotion icon displays correctly |
| Preview edit | Click "Edit Prompt" in preview | Re-prompts and re-previews |
| Cancel at step | Press Escape at any step | Wizard aborts, no partial save |
| Immediate switch | Click "Switch to This Crew" | Crew switches immediately |

### T8.9.5: Crew Editing Verification

| Test | Steps | Expected Result |
|------|-------|----------------|
| Edit name | Select crew → Edit Name → Enter new name | Name updated, status bar refreshed if active |
| Edit prompt | Select crew → Edit Prompt → Edit in editor | Prompt updated, system prompt rebuilt if active |
| Edit emotion | Select crew → Edit Emotion → Select emotion | Emotion updated, icon refreshed |
| Open file | Select crew → Open File | Raw JSON opens in editor |
| Delete non-default | Select non-default crew → Delete | Confirmation, crew deleted |
| Delete default | Select default crew | Delete option not shown |
| Delete active | Select active crew → Delete | Warning: switch first |
| Edit active crew | Edit the currently active crew | Status bar and system prompt update immediately |

### T8.9.6: Config Sync Verification

| Test | Steps | Expected Result |
|------|-------|----------------|
| External provider change | Edit `config.json` via CLI, change provider | VS Code detects, reloads, prompts restart |
| External model change | Edit `config.json`, change model | VS Code detects, model switches |
| External delete | Delete `config.json` | Warning shown |
| VS Code → config | Change `agentx.provider` in Settings | Config file updated, engine switches |
| Loop prevention | Change config externally while syncing | No infinite loop |
| Debounce | Rapid file changes | Only one reload after debounce period |
| Hash check | Touch file without content change | No reload triggered |

### T8.9.7: Status Bar Verification

| Test | Expected Result |
|------|----------------|
| Provider indicator | Shows icon + name, tooltip has full details |
| Provider click | Opens provider picker |
| Model indicator | Shows icon + name + context window |
| Model click | Opens model picker |
| Crew indicator | Shows emotion icon + name |
| Crew click | Opens crew picker |
| Model trial | Spinning indicator during trial |
| Provider error | Red background, error icon |
| Error click | Opens provider config |
| Tooltip format | Rich Markdown with provider/model/session details |

### T8.9.8: Error Handling Verification

| Test | Expected Result |
|------|----------------|
| Invalid API key | Validation error, retry option |
| Unreachable provider | Validation timeout, error message |
| Network error during model fetch | Fallback to manual model input |
| Model trial failure | Warning, option to pick another |
| Config save failure | Error message, no partial state |
| CrewManager error | Error message, no data corruption |
| Engine not initialized | Lazy initialization triggered |

### T8.9.9: Lint and Type Check

```bash
pnpm --filter @agentx/vscode run typecheck
pnpm --filter @agentx/vscode run lint
```

Both must pass with zero errors.

---

## File Summary

| File | Purpose | Created In |
|------|---------|-----------|
| `packages/vscode/src/commands/ProviderPicker.ts` | Provider metadata registry + QuickPick picker | T8.1 |
| `packages/vscode/src/commands/ModelPicker.ts` | Model QuickPick with trial + switch | T8.2 |
| `packages/vscode/src/commands/ProviderConfig.ts` | Multi-step provider config wizard + profiles | T8.3 |
| `packages/vscode/src/commands/CrewPicker.ts` | Crew QuickPick with emotion icons | T8.4 |
| `packages/vscode/src/commands/CrewCreator.ts` | Multi-step crew creation wizard | T8.5 |
| `packages/vscode/src/commands/CrewEditor.ts` | Crew edit menu + name/prompt/emotion editors | T8.6 |
| `packages/vscode/src/statusbar/ProviderModelStatusBar.ts` | Enhanced status bar for provider/model/crew | T8.7 |
| `packages/vscode/src/config/ConfigSync.ts` | Bidirectional config sync with file watcher | T8.8 |

---

## Engine API Reference (Used in This Phase)

| API | Source | Usage |
|-----|--------|-------|
| `ProviderFactory.create(id, apiKey?, baseUrl?)` | `packages/engine/src/providers/index.ts` | Create provider for validation |
| `ProviderInterface.validate()` | `packages/engine/src/providers/ProviderInterface.ts` | Test provider connection |
| `ProviderInterface.listModels()` | `packages/engine/src/providers/ProviderInterface.ts` | Fetch available models |
| `Agent.switchProvider(id, apiKey?, baseUrl?)` | `packages/engine/src/agent/Agent.ts:1519` | Switch active provider |
| `Agent.switchModel(modelId, contextWindow?)` | `packages/engine/src/agent/Agent.ts:1524` | Switch active model |
| `Agent.trialModel(modelId)` | `packages/engine/src/agent/Agent.ts:1586` | Pre-flight model check |
| `Agent.listModels()` | `packages/engine/src/agent/Agent.ts:1634` | List + cache models |
| `Agent.rebuildSystemPrompt()` | `packages/engine/src/agent/Agent.ts:1434` | Rebuild after crew switch |
| `Agent.isModelGrounded(modelId)` | `packages/engine/src/agent/Agent.ts:1623` | Check failed models |
| `CrewManager.list()` | `packages/engine/src/secret-sauce/CrewManager.ts:119` | List all crews |
| `CrewManager.getActive()` | `packages/engine/src/secret-sauce/CrewManager.ts:111` | Get active crew |
| `CrewManager.getActiveId()` | `packages/engine/src/secret-sauce/CrewManager.ts:115` | Get active crew ID |
| `CrewManager.switch(id)` | `packages/engine/src/secret-sauce/CrewManager.ts:127` | Switch active crew |
| `CrewManager.create(input)` | `packages/engine/src/secret-sauce/CrewManager.ts:135` | Create new crew |
| `CrewManager.update(id, updates)` | `packages/engine/src/secret-sauce/CrewManager.ts:160` | Update crew fields |
| `CrewManager.delete(id)` | `packages/engine/src/secret-sauce/CrewManager.ts:150` | Delete non-active crew |
| `CrewManager.get(id)` | `packages/engine/src/secret-sauce/CrewManager.ts:123` | Get crew by ID |
| `ConfigManager.load()` | `packages/engine/src/config/ConfigManager.ts` | Load config from disk |
| `ConfigManager.save()` | `packages/engine/src/config/ConfigManager.ts` | Save config to disk |

---

## Shared Types Reference

| Type | Source | Fields |
|------|--------|--------|
| `ProviderId` | `packages/shared/src/types/provider.ts` | Union of 15 provider string literals |
| `ModelInfo` | `packages/shared/src/types/provider.ts` | `id`, `name`, `providerId`, `contextWindow`, `capabilities`, `pricing` |
| `Crew` | `packages/shared/src/types/crew.ts` | `id`, `name`, `systemPrompt`, `emotion?`, `isDefault`, `createdAt`, `updatedAt` |
| `CrewEmotion` | `packages/shared/src/types/crew.ts` | Union of 10 emotion string literals |
| `ProviderConfig` | `packages/shared/src/types/provider.ts` | `id`, `name`, `type`, `apiKeyRequired`, `baseUrlConfigurable`, `defaultBaseUrl` |
