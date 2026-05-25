# Mission Control Setup Wizard — Implementation Spec

> Full-screen, center-aligned, space-themed onboarding experience for Agent-X first launch.

---

## 1. Overview

When Agent-X detects no existing configuration (`~/.config/agentx/config.json` doesn't exist), instead of the current compact `SetupWizard`, we render **Mission Control** — a full-screen, center-aligned wizard that feels like booting up a starship's AI core.

### Flow Summary

```
[Splash Screen] → [Stage 1: Neural Core] → [Stage 2: Mission Profile] → [Stage 3: Comms Array] → [Launch Sequence] → Chat
```

### Key Principles
- Full terminal height/width — uses `useStdout()` to fill the screen
- Content is center-aligned (both vertically and horizontally)
- All content lives inside a bordered "card" (max 60 cols wide)
- Bottom progress rail shows current stage
- Animated transitions between stages (1.5s boot sequence)
- Escape goes back (per sub-step); Ctrl+C exits completely

---

## 2. Architecture

### 2.1 New Files

| File | Purpose |
|------|---------|
| `packages/tui/src/screens/MissionControl.tsx` | Main orchestrator — state machine, renders appropriate sub-component |
| `packages/tui/src/components/wizard/StageCard.tsx` | Full-screen wrapper with centered bordered card |
| `packages/tui/src/components/wizard/ProgressRail.tsx` | Bottom bar: `● ─── ○ ─── ○ ─── ○` showing 4 nodes (3 stages + launch) |
| `packages/tui/src/components/wizard/BootTransition.tsx` | Animated transition between stages (progress bar + system label) |
| `packages/tui/src/components/wizard/SplashScreen.tsx` | Opening splash with ASCII art + "Press ENTER to begin" |
| `packages/tui/src/components/wizard/LaunchSequence.tsx` | Final countdown animation before entering chat |

### 2.2 Modified Files

| File | Change |
|------|--------|
| `packages/tui/src/App.tsx` | Replace `SetupWizard` import/usage with `MissionControl`; `MissionControl` now handles both config setup AND profile creation, emitting `onComplete(config, profile)` |
| `packages/shared/src/types/config.ts` | Add optional `user?: { callsign: string }` field to `AgentXConfig` |
| `packages/engine/src/config/ConfigSchema.ts` | Add `user` Zod schema (optional object with callsign string) |
| `packages/tui/src/theme/layout.ts` | Add wizard-specific layout constants |

### 2.3 Unchanged / Reused

| Component | How it's reused |
|-----------|----------------|
| `ScrollableList` | Provider selection, model selection, tone selection (unchanged) |
| `LoadingIndicator` | During validation/model fetch |
| `useAnimation` | Spinner in transitions |
| `useTypewriter` | Text reveal in splash, briefings, transitions |
| `COLORS` | Same space theme palette |
| `ProviderFactory` | Validate + listModels |
| `ProfileManager` | Create first profile |
| `TelegramStore` | Save bot token |
| `ConfigManager` | Save final config |

The existing `SetupWizard.tsx` and `ProfileSelect.tsx` are **not deleted** — they remain for the `/setup` command and `/profile` command respectively. `MissionControl` is the NEW first-run experience that replaces the `App.tsx` routing to `SetupWizard`.

---

## 3. State Machine

```typescript
type MissionControlStep =
  // Splash
  | 'splash'
  // Stage 1: Neural Core
  | 'stage1_provider'
  | 'stage1_credentials'    // API key OR base URL depending on provider
  | 'stage1_validating'     // Animated validation
  | 'stage1_models'         // Model selection
  // Transition 1→2
  | 'transition_1'
  // Stage 2: Mission Profile
  | 'stage2_callsign'       // "What should I call you, Commander?"
  | 'stage2_briefing'       // Explains profiles (typewriter)
  | 'stage2_name'           // Name the profile/agent
  | 'stage2_prompt'         // System prompt
  | 'stage2_tone'           // Emotion/personality
  // Transition 2→3
  | 'transition_2'
  // Stage 3: Comms Array
  | 'stage3_telegram'       // Bot token (skippable)
  // Transition 3→launch
  | 'transition_3'
  // Launch
  | 'launch_sequence';
```

### Navigation Rules
- **Enter** advances to next step (or submits input)
- **Escape** goes back one step (within a stage)
- **Escape on first step of a stage** goes back to previous stage's last step
- **Escape on splash** → exits (`process.exit(0)`)
- **Tab** on stage3_telegram → skip (moves to transition_3)
- Transitions are non-interactive (auto-advance after 1.5s)

---

## 4. Component Specs

### 4.1 `StageCard` — Full-Screen Centered Container

```
Props:
  - stageNumber: 1 | 2 | 3 | null (null = splash/launch)
  - stageLabel: string (e.g. "NEURAL CORE")
  - children: ReactNode
  - showProgress: boolean
  - currentStage: number (for ProgressRail)
```

**Layout logic:**
```tsx
const { stdout } = useStdout();
const rows = stdout?.rows ?? 24;
const cols = stdout?.columns ?? 80;
const cardWidth = Math.min(60, cols - 4);  // 60 cols max, 2 padding each side

<Box width={cols} height={rows} flexDirection="column" justifyContent="center" alignItems="center">
  <Box
    width={cardWidth}
    flexDirection="column"
    borderStyle="double"
    borderColor={COLORS.primary}
    paddingX={2}
    paddingY={1}
  >
    {/* Stage header */}
    {stageNumber && (
      <Box marginBottom={1}>
        <Text color={COLORS.primary} bold>⊹ STAGE {stageNumber}: {stageLabel}</Text>
      </Box>
    )}
    {/* Separator */}
    {stageNumber && <Text color={COLORS.border}>{'─'.repeat(cardWidth - 6)}</Text>}
    {/* Content */}
    <Box flexDirection="column" marginTop={1}>
      {children}
    </Box>
  </Box>
  {/* Progress rail below card */}
  {showProgress && <ProgressRail currentStage={currentStage} />}
</Box>
```

### 4.2 `ProgressRail`

```
Props:
  - currentStage: 0 | 1 | 2 | 3 | 4  (0=splash, 1-3=stages, 4=launch)
```

Renders:
```
   ● ━━━━ ○ ━━━━ ○ ━━━━ ○
  CORE  PROFILE  COMMS  LAUNCH
```

Active stages are `●` in `COLORS.primary`, upcoming are `○` in `COLORS.textDim`.
Completed stages are `●` in `COLORS.success`.
The connecting lines are `━━━━` in `COLORS.border` (dim) or `COLORS.success` (if segment completed).

### 4.3 `BootTransition`

```
Props:
  - label: string (e.g. "NEURAL CORE — ONLINE")
  - color: string (COLORS.success for completed stages)
  - onComplete: () => void (called after animation finishes)
```

Shows a 1.5-second animation:
1. Progress bar fills from 0% → 100% over 1s
2. Label appears with typewriter effect
3. Brief pause (0.5s), then calls `onComplete`

```
    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  100%
    ✓ NEURAL CORE — ONLINE
```

### 4.4 `SplashScreen`

```
Props:
  - onStart: () => void (Enter pressed)
  - onExit: () => void (Escape pressed)
```

Renders (inside StageCard with stageNumber=null):
```
        ✦  A G E N T - X  ✦

      ░▒▓█  MISSION CONTROL  █▓▒░

      « First Launch Detected »

      Initializing starship systems...

            Press ENTER to begin

              v0.1.33
```

- Title in `COLORS.primary` bold
- "MISSION CONTROL" in `COLORS.accent`
- "First Launch Detected" typewriter effect
- "Press ENTER" in `COLORS.textDim`, blinking (toggling visibility every 800ms)

### 4.5 `LaunchSequence`

```
Props:
  - telegramConfigured: boolean
  - profileName: string
  - onComplete: () => void
```

Shows a 3-second sequence:
```
      ALL SYSTEMS OPERATIONAL

  ✓ Neural Core ........... ONLINE
  ✓ Mission Profile ....... LOADED
  ✓ Comms Array ........... LINKED  (or SKIPPED)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

       « LAUNCHING AGENT-X »

           3... 2... 1...
```

- Each system line appears one at a time (staggered 0.5s)
- Countdown shows 3→2→1 with 1s interval
- After countdown, calls `onComplete`

---

## 5. Stage Details

### 5.1 Stage 1: Neural Core

#### Step: `stage1_provider`
- Renders `ScrollableList` with provider options
- Each item shows: `{provider.name}` + description in dim text
- Provider items:
  ```
  OpenAI       — GPT-4o, o1, o3
  Anthropic    — Claude 4, Sonnet
  Google       — Gemini 2.5 Pro/Flash
  Ollama       — Local models • Private
  LM Studio    — Local models • Private
  ```
- On select → store `selectedProvider`, advance to `stage1_credentials`

#### Step: `stage1_credentials`
- **If cloud provider** (apiKeyRequired=true): Shows masked text input for API key
  - Label: `🔐 Enter your {ProviderName} clearance key:`
  - Below input: privacy note in dim text
  - Submit → advance to `stage1_validating`
- **If local provider**: Shows text input for base URL with default value pre-filled
  - Label: `🔗 Base URL (press Enter for default):`
  - Default shown: `http://localhost:11434` (ollama) or `http://localhost:1234/v1` (lmstudio)
  - Submit → advance to `stage1_validating`
- **If neither** (no key, no URL): skip directly to `stage1_validating`

#### Step: `stage1_validating`
- Shows `LoadingIndicator` + "Establishing neural link..."
- Calls `ProviderFactory.create().validate()` → on success fetches models
- On failure: shows error in `COLORS.error`, goes back to `stage1_credentials`
- On model fetch success → advance to `stage1_models`

#### Step: `stage1_models`
- Renders `ScrollableList` with models (from provider.listModels())
- Each item shows: `{model.id}` + context window in dim text (if available)
- On select → store `selectedModel`, advance to `transition_1`

---

### 5.2 Stage 2: Mission Profile

#### Step: `stage2_callsign`
- Label: `What should I call you, Commander?`
- Text input, placeholder: `e.g. Alex, Captain, Boss`
- Hint: `This is how Agent-X will address you.`
- Submit → store callsign, advance to `stage2_briefing`

#### Step: `stage2_briefing`
- Non-interactive typewriter text explaining profiles:
  ```
  Profiles are your AI crew members.

  Each profile is a sub-agent with its own
  personality, expertise, and communication style.

  You can create multiple profiles later:
    "Nova"  — Your coding specialist
    "Atlas" — Research & analysis
    "Pulse" — Creative writing

  Let's create your first crew member.
  ```
- After typewriter completes, shows "Press ENTER to continue" (blinking)
- Enter → advance to `stage2_name`

#### Step: `stage2_name`
- Label: `Name your first crew member:`
- Text input, placeholder: `e.g. Nova, Atlas, Jarvis`
- Hint: `This is the agent's callsign. You'll switch between agents by name.`
- Submit → advance to `stage2_prompt`

#### Step: `stage2_prompt`
- Label: `What is {profileName}'s specialization?`
- Text input, placeholder: `e.g. A senior full-stack engineer who...`
- Hint: `Describe their role, expertise, and any instructions.`
- Submit → advance to `stage2_tone`

#### Step: `stage2_tone`
- Label: `Choose {profileName}'s communication style:`
- Renders `ScrollableList` with tone options (same 10 as ProfileSelect)
- On select → advance to `transition_2`

---

### 5.3 Stage 3: Comms Array

#### Step: `stage3_telegram`
- Explanation block:
  ```
  📡 Connect a communication channel

  Telegram lets you talk to Agent-X from
  your phone — anywhere, anytime.
  It also receives files, images, and
  voice messages.

  ┌─────────────────────────────────────┐
  │ 1. Open @BotFather on Telegram      │
  │ 2. Send /newbot and follow prompts  │
  │ 3. Paste the bot token below        │
  └─────────────────────────────────────┘
  ```
- Masked text input for bot token
- Bottom hints: `⏎ Submit  •  Tab Skip for now`
- **Tab** → advance to `transition_3` (skip telegram)
- **Submit** → validate token format (should contain `:`), save via `TelegramStore.save()`, advance to `transition_3`
- Escape → goes back to `transition_2` (which immediately re-shows stage2's last completed state... actually just back to `stage2_tone`)

---

## 6. Data Persistence

When the Launch Sequence completes, `MissionControl` calls its `onComplete` callback with:

```typescript
interface MissionControlResult {
  config: AgentXConfig;     // Full config with provider, model, user.callsign
  profile: Profile;         // Created profile (already saved via ProfileManager)
}
```

**What gets saved and when:**

| Data | Storage | Saved when |
|------|---------|------------|
| Provider + Model + Credentials | `~/.config/agentx/config.json` via `ConfigManager.save()` | End of Stage 1 (before transition_1) |
| User callsign | `~/.config/agentx/config.json` (new `user.callsign` field) | End of Stage 2 (with config update) |
| Profile | `~/.local/share/agentx/secret-sauce/profiles.json` via `ProfileManager.create()` | End of Stage 2 |
| Telegram token | `~/.config/agentx/telegram.json` via `TelegramStore.save()` | End of Stage 3 (if not skipped) |

This way, if the user quits mid-wizard after Stage 1, the config exists and next launch detects `isConfigured() = true` → skips to profile select (existing behavior works as fallback).

---

## 7. Schema Change

### `packages/shared/src/types/config.ts`

Add:
```typescript
export interface UserConfig {
  callsign: string;
}

export interface AgentXConfig {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  timezone?: string;
  user?: UserConfig;  // NEW — optional for backward compat
}
```

### `packages/engine/src/config/ConfigSchema.ts`

Add:
```typescript
export const userConfigSchema = z.object({
  callsign: z.string().min(1).max(30),
}).optional();

// Add to agentXConfigSchema:
  user: userConfigSchema,
```

---

## 8. App.tsx Changes

```typescript
// Before:
if (state === 'setup') {
  return <SetupWizard onComplete={handleSetupComplete} onCancel={handleSetupCancel} />;
}

// After:
if (state === 'setup') {
  return <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />;
}
```

Where `handleMissionComplete` receives both `config` and `profile`:
```typescript
const handleMissionComplete = useCallback((config: AgentXConfig, profile: Profile) => {
  setConfig(config);
  setActiveProfile(profile);
  setState('main');  // Skip profile select — we already created one
}, []);
```

This means after Mission Control, we go **directly to chat** (no ProfileSelect step).

---

## 9. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Terminal too small (< 60 cols or < 20 rows) | Show warning: "Terminal too small. Resize to at least 60×20." with current dims shown. Block wizard until resized. |
| API key validation fails | Show error in-card in `COLORS.error`, return to credentials step. Error clears on next input change. |
| Model list empty | Show "No models available" error, return to credentials step |
| Network timeout | Show "Connection lost — check your internet" error, allow retry |
| Telegram token invalid format | Show inline error "Token should look like: 123456:ABC..." |
| User hits Ctrl+C at any point | Standard Ink exit (app terminates) |
| Config file already exists (edge case) | Shouldn't reach Mission Control, but if it does, just overwrite |

---

## 10. Animation Timing

| Animation | Duration | Hook Used |
|-----------|----------|-----------|
| Splash typewriter | ~2s | `useTypewriter(text, 40)` |
| "Press ENTER" blink | 800ms interval | `useState` + `setInterval` |
| Boot transitions | 1.5s total (1s bar + 0.5s pause) | `useEffect` + `setTimeout` |
| Launch countdown | 3s (0.5s per system line + 1s per number) | Staggered `setTimeout` |
| Stage header appearance | instant (no animation) | — |
| Error messages | fade-in 150ms | `useFadeIn` |

---

## 11. Visual Reference — Color Usage

| Element | Color |
|---------|-------|
| Card border | `COLORS.primary` (#00D4FF cyan) — double border style |
| Stage headers | `COLORS.primary` bold |
| Input labels | `COLORS.text` (#E6EDF3 white) |
| Input placeholder | `COLORS.textDim` (#7D8590 gray) |
| Hints / helper text | `COLORS.textDim` dimColor |
| Privacy notes | `COLORS.textDim` italic |
| Error messages | `COLORS.error` (#FF5252 red) |
| Success / completed | `COLORS.success` (#69F0AE green) |
| Accent text (MISSION CONTROL, profile examples) | `COLORS.accent` (#B388FF purple) |
| Progress rail active | `COLORS.primary` |
| Progress rail completed | `COLORS.success` |
| Progress rail upcoming | `COLORS.textDim` |
| Transition progress bar fill | `COLORS.primary` → `COLORS.success` |

---

## 12. File Size Estimates

| File | Approx Lines |
|------|-------------|
| `MissionControl.tsx` | ~350 (state machine + step logic) |
| `StageCard.tsx` | ~60 |
| `ProgressRail.tsx` | ~50 |
| `BootTransition.tsx` | ~70 |
| `SplashScreen.tsx` | ~80 |
| `LaunchSequence.tsx` | ~90 |
| Schema changes | ~10 lines across 2 files |
| App.tsx changes | ~15 lines changed |
| **Total new code** | **~700 lines** |

---

## 13. Testing Strategy

1. **Manual smoke test** — run `agentx` with no config (delete `~/.config/agentx/` first, or use a mock home dir)
2. **Verify backward compat** — existing configs still load (no regression in `ConfigManager.load()`)
3. **Verify skip paths** — Tab on telegram, Escape navigation, small terminal warning
4. **Verify persistence** — after wizard, config.json has all fields; profiles.json has the created profile; telegram.json exists if token provided

---

## 14. Dependencies

**No new npm packages required.** Everything uses existing:
- `ink` (Box, Text, useInput, useStdout, useApp)
- `ink-text-input` (TextInput)
- Existing hooks (`useAnimation`, `useTypewriter`, `useFadeIn`)
- Existing engine classes (`ConfigManager`, `ProviderFactory`, `ProfileManager`, `TelegramStore`)

---

## 15. Migration Notes

- Existing users (who have config) **never see Mission Control** — they continue with the current ProfileSelect flow
- The old `SetupWizard.tsx` is kept for potential future use (e.g. `/reconfigure` command) but is no longer the first-run entrypoint
- The `user.callsign` field is optional in the schema, so existing configs validate fine without it
