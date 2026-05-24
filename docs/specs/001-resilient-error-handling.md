# SPEC-001: Resilient Error Handling & User Experience

> **Status:** Draft  
> **Created:** 2025-05-25  
> **Author:** Agent-X Core  
> **Priority:** Critical  

---

## 1. Problem Statement

Agent-X currently exposes raw technical errors (stack traces, HTTP status codes, provider error messages) to users. When configuration is invalid (e.g. bad API key saved without validation), the application crashes on next use with no recovery path. This violates the space-themed immersive UX we've established.

### Observed Failure Scenario

1. User enters a dummy/invalid API key during setup
2. Key is saved to config without validation
3. User runs `/model` → provider returns `401 Unauthorized`
4. Unhandled error propagates → Node.js crashes with raw stack trace
5. On next launch, the same faulty config causes repeated crashes
6. User is stuck with no recovery path

---

## 2. Specification

### 2.1 Error Presentation — Space-Themed Only

**Requirement:** No technical error (HTTP codes, stack traces, raw provider messages) shall ever be displayed to the user.

All user-facing errors MUST use space-themed language from the shared `STATUS_MESSAGES` constants:

| Internal Error | User-Facing Message |
|---|---|
| 401 Unauthorized | "Transmission rejected — invalid credentials. Reconfigure your access codes." |
| 403 Forbidden | "Access denied — clearance level insufficient." |
| 404 Not Found | "Signal lost — resource not found in this sector." |
| 429 Rate Limited | "Orbit congested — too many transmissions. Stand by." |
| 500+ Server Error | "Ground control unresponsive. Retry in a moment." |
| Network Error | "Deep space signal lost. Check your connection." |
| Timeout | "Transmission timed out — target unreachable." |
| Unknown | "Anomaly detected. Check mission log for details." |

### 2.2 Model Listing — API-Only, No Defaults

**Requirement:** Model lists MUST come exclusively from the provider's API. No fallback/default model lists.

- If the API call fails, show a space-themed error: _"Unable to contact ground control for available craft. Check your access codes."_
- Never display a hardcoded/assumed list of models
- The user should be guided to fix the issue (reconfigure key, check network)

### 2.3 Model Selection — Trial Before Commit

**Requirement:** When a user selects a model, perform a lightweight trial API call BEFORE persisting the selection.

Flow:
1. User picks a model from the API-returned list
2. Send a minimal completion request (e.g. `messages: [{role: "user", content: "ping"}], max_tokens: 1`)
3. **Success:** Persist model to config, confirm to user
4. **Failure:** Mark model as `unavailable` for this session, show message: _"Craft [model] is grounded — pick another."_
5. Unavailable models remain visible in the list but are grayed out / non-selectable
6. Return user to model picker to choose again

### 2.4 Profiles — User-Created Only

**Requirement:** Remove all built-in/default profiles. Profiles are exclusively user-created.

Profile structure (simplified):
```
{
  name: string;       // Display name (required)
  prompt: string;     // System prompt / persona instructions (required)
}
```

- **No `description` field** — only `name` and `prompt`
- On first launch with no profiles, guide user through creating one
- Profile creation flow explains purpose:
  - "Name: What should we call this mission profile?"
  - "Prompt: What are your standing orders for the AI? (personality, expertise, constraints)"

### 2.5 Config Validation & Rollback

**Requirement:** Never persist configuration that hasn't been validated. If faulty config causes a crash, rollback on next launch.

#### Pre-Save Validation
Before saving any config change:
1. **API Key:** Make a lightweight API call (`/models` or equivalent) to validate
2. **Model:** Trial completion call (see 2.3)
3. **Provider switch:** Validate new provider's key before committing

If validation fails → do NOT save → show error → keep previous working config

#### Crash Recovery (Rollback)
- Before writing config, save a backup: `config.backup.json`
- On application start, check for crash markers:
  - If `config.json` exists but app crashed on last run (detected via `.agentx-crash-marker` file)
  - Restore `config.backup.json` → delete crash marker
  - Show message: _"Last mission config caused an anomaly. Reverted to last stable configuration."_
- Crash marker lifecycle:
  - Written on app start (before agent initialization)
  - Deleted on clean shutdown / after successful first interaction
  - If present on next start → previous run crashed

### 2.6 Error Logging — Silent File Logger

**Requirement:** All technical errors, stack traces, and debug info must be written to a log file. Never to stdout/stderr that the user sees.

- Log file location: `~/.agentx/logs/error.log`
- Log format: `[ISO-8601] [LEVEL] [COMPONENT] message`
- Rotate: Keep last 5 files, max 5MB each
- Levels: `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`
- On crash: Write full stack trace + config snapshot (redacted API keys) to log
- Global handlers:
  - `process.on('uncaughtException', ...)` → log + graceful shutdown
  - `process.on('unhandledRejection', ...)` → log + continue if recoverable

---

## 3. Implementation Plan

### Phase 1: Error Logger Service

Create `packages/shared/src/logger.ts`:
- File-based logger with rotation
- Singleton pattern, importable from any package
- Methods: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`, `logger.fatal()`
- Writes to `~/.agentx/logs/error.log`
- Rotation: 5 files × 5MB max

### Phase 2: Global Crash Handlers

Update `packages/cli/src/index.ts`:
- Add `process.on('uncaughtException', handler)`
- Add `process.on('unhandledRejection', handler)`
- Handler: log full error → write crash marker → show space-themed farewell → exit(1)
- On startup: check crash marker → rollback if needed

### Phase 3: Config Backup & Rollback

Update `packages/engine/src/config/ConfigManager.ts`:
- `save()`: write `config.backup.json` before overwriting `config.json`
- Add `rollback()`: restore from backup
- Add `writeCrashMarker()` / `clearCrashMarker()` / `hasCrashMarker()`
- On startup in CLI: if crash marker exists, call `rollback()`

### Phase 4: API Key Validation on Save

Update provider setup flow:
- Before saving a new API key, call provider's `validate()` method
- If validation fails → reject the save → show: _"Access codes rejected by ground control. Double-check and retry."_
- Only persist keys that pass validation

### Phase 5: Model Selection with Trial

Update `Agent.switchModel()` / `selectModel()` in useSession:
- Before persisting, call `verifyModel(modelId)` and AWAIT it
- If verification fails:
  - Add `modelId` to session-scoped `unavailableModels: Set<string>`
  - Emit event: `{ type: 'model_unavailable', modelId }`
  - Re-open model picker with that model marked
- In model picker UI:
  - Gray out unavailable models
  - Show "(grounded)" suffix
  - Skip them on Enter press

### Phase 6: Remove Default/Fallback Models

Revert fallback model lists in:
- `GoogleProvider.listModels()` → remove `getFallbackModels()`
- `OpenAIProvider.listModels()` → remove `getFallbackModels()`
- `AnthropicProvider.listModels()` → remove `fallbackModels()`

If API returns error or empty list:
- Emit user-facing error via event bus (space-themed)
- Log technical error to file
- Guide user toward fixing config

### Phase 7: Remove Default Profiles

Update profile system:
- Remove all hardcoded profile definitions
- On first launch with zero profiles → guide through profile creation
- Profile creation asks for:
  - Name: "What should we call this mission profile?"
  - Prompt: "What are your standing orders for the AI?"
- Remove `description` field from Profile type
- Update profile picker to only show user-created profiles + "Create new"

### Phase 8: Space-Themed Error Mapping

Create `packages/shared/src/constants/errors.ts`:
- Map HTTP codes → space-themed messages
- Map error categories → user-facing strings
- Export `getUserMessage(error: Error | string): string` utility
- All components use this instead of raw error text

---

## 4. Task Breakdown

| # | Task | Package | Depends On |
|---|------|---------|-----------|
| 1 | Create file logger service with rotation | shared | — |
| 2 | Add global crash handlers + crash marker system | cli | 1 |
| 3 | Add config backup/rollback to ConfigManager | engine | 1 |
| 4 | Create space-themed error message mapping | shared | — |
| 5 | Add API key validation before save in setup flow | engine | 1, 4 |
| 6 | Implement model trial-before-commit in selectModel | tui, engine | 4 |
| 7 | Add session-scoped unavailable models + UI graying | tui | 6 |
| 8 | Remove all fallback/default model lists from providers | engine | 6 |
| 9 | Remove default profiles, simplify to name+prompt | shared, engine, tui | — |
| 10 | Replace all raw error displays with space-themed messages | tui | 4 |
| 11 | Ensure no technical text leaks to user in any component | tui | 4, 10 |
| 12 | Integration test: bad key → validate → reject → no crash | engine | 3, 5 |
| 13 | Integration test: model trial fail → mark → re-pick | engine, tui | 6, 7 |

---

## 5. Acceptance Criteria

- [ ] Running with an invalid API key shows _"Access codes rejected"_ — never a stack trace
- [ ] `/model` with a bad key shows _"Unable to contact ground control"_ — no crash
- [ ] Selecting an unavailable model marks it grounded and re-opens picker
- [ ] `~/.agentx/logs/error.log` contains full technical details for debugging
- [ ] After a crash, next launch restores last working config automatically
- [ ] No profile named "General Assistant" or "Software Architect" etc. exists by default
- [ ] Creating a profile asks only for name + prompt
- [ ] Zero occurrences of HTTP status codes, stack traces, or "Error:" in user-visible text
