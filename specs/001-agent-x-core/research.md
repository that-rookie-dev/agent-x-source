# Research: Agent-X Core Platform

**Date**: 2026-05-22

**Purpose**: Technology validation, version compatibility, and architectural decisions for Agent-X.

---

## 1. React Ink 7.x (TUI Framework)

### Version: 7.0.3 (Latest - released May 2026)

### Key Capabilities Confirmed:
- **Flexbox layout** via Yoga engine — full CSS-like positioning
- **`useAnimation` hook** — frame counter, elapsed time, delta, reset function. Shared single timer for all animations
- **`useInput` hook** — arrow keys, return, escape, ctrl, shift, tab, backspace, page up/down
- **`useFocus` / `useFocusManager`** — Tab-based focus cycling, programmatic focus by ID
- **`useCursor`** — Terminal cursor positioning for IME support
- **`useWindowSize`** — Responsive to terminal resize
- **`<Static>` component** — Permanent output above dynamic content (perfect for message history)
- **`<Transform>` component** — String transformation (gradient, effects)
- **`alternateScreen` option** — Full-screen mode like vim/htop (ideal for Agent-X)
- **`incrementalRendering`** — Only updates changed lines (reduces flicker)
- **`concurrent` mode** — React Suspense support for async data fetching
- **`kittyKeyboard`** — Enhanced keyboard support (press/repeat/release detection)
- **`maxFps: 30`** — Configurable render throttle
- **Border styles** — single, double, round, bold, custom
- **Background colors** — Full RGB/hex support on `<Box>` elements
- **Screen reader support** — ARIA roles, states, labels

### Critical for Agent-X:
- `alternateScreen: true` — Enables full-screen TUI without polluting scrollback
- `incrementalRendering: true` — Reduces visual artifacts during animation
- `maxFps: 30` — Balances smoothness with CPU usage
- `concurrent: true` — Allows Suspense boundaries for async provider calls
- `kittyKeyboard: { mode: 'auto' }` — Enhanced key detection where supported

### Third-Party Ink Components (Validated):
| Component | Purpose | Stars | Maintained |
|-----------|---------|-------|------------|
| ink-text-input | Text input field | 400+ | Yes |
| ink-select-input | Select/dropdown | 200+ | Yes |
| ink-spinner | Loading spinners | 400+ | Yes |
| ink-gradient | Gradient text | 500+ | Yes |
| ink-big-text | ASCII art text (figlet) | 300+ | Yes |
| ink-progress-bar | Progress bars | 100+ | Yes |
| ink-table | Table rendering | 200+ | Yes |
| ink-scroll-view | Scroll container | New | Yes |
| ink-scroll-list | Scrollable list | New | Yes |
| ink-syntax-highlight | Code highlighting | 50+ | Yes |
| ink-tab | Tab navigation | 100+ | Yes |
| ink-markdown | Markdown rendering | 100+ | Yes |

### Animation Approach:
React Ink 7.x's `useAnimation` hook is the primary animation driver:
```typescript
const { frame, time, delta, reset } = useAnimation({ interval: 80 });
```
- All animations consolidated into single render cycle
- `frame` for indexed sequences (spinner frames)
- `time` for continuous animations (sine waves, progress)
- `delta` for physics-based motion
- `reset()` for event-triggered animations

### Render Performance:
- Default 30fps max render rate
- Incremental rendering only updates changed lines
- `<Static>` items render once and are never re-rendered
- React concurrent mode enables prioritized updates

---

## 2. AI Provider SDKs

### OpenAI SDK (`openai` v5.x)
- **Streaming**: `stream: true` returns `AsyncIterable<ChatCompletionChunk>`
- **Function calling**: Native tool/function support
- **Token counting**: `tiktoken` library for precise pre-call estimation
- **Models**: GPT-4o, GPT-4-turbo, o1, o3, o4-mini
- **Rate limiting**: Built-in retry with exponential backoff

### Anthropic SDK (`@anthropic-ai/sdk` v0.35+)
- **Streaming**: `stream()` method returns event stream
- **Tool use**: Native tool definitions with input schemas
- **Token counting**: API returns usage in response; `@anthropic-ai/tokenizer` for pre-count
- **Models**: Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku
- **Context windows**: Up to 200K tokens

### Google Generative AI (`@google/generative-ai` v0.20+)
- **Streaming**: `generateContentStream()` for streaming
- **Function calling**: Supported via tool declarations
- **Token counting**: `countTokens()` built-in method
- **Models**: Gemini 2.5 Pro, Gemini 2.5 Flash
- **Context windows**: Up to 1M tokens (Gemini Pro)

### Ollama (Local - `ollama` v0.5+)
- **API**: REST API on localhost:11434
- **Streaming**: SSE-based streaming
- **Models**: Llama 3.x, Mistral, CodeLlama, Deepseek, Qwen
- **Token counting**: Model-specific tokenizers
- **Benefits**: Zero latency to API, no cost, full privacy
- **Limitation**: Performance depends on local hardware

### LM Studio (Local)
- **API**: OpenAI-compatible REST API on configurable localhost port
- **Integration**: Can use OpenAI SDK with custom `baseURL`
- **Models**: Any GGUF model loaded in LM Studio
- **Benefits**: GUI for model management, easy model switching

### Provider Abstraction Strategy:
```typescript
interface AIProvider {
  id: string;
  name: string;
  type: 'cloud' | 'local';
  validate(credentials: ProviderCredentials): Promise<ValidationResult>;
  listModels(): Promise<ModelInfo[]>;
  complete(request: CompletionRequest): AsyncGenerator<CompletionChunk>;
  countTokens(messages: Message[]): Promise<number>;
  getContextWindow(model: string): number;
}
```

All providers normalize to `AsyncGenerator<CompletionChunk>` for streaming, enabling the UI layer to handle all providers identically.

---

## 3. Token Counting Libraries

### tiktoken (OpenAI models)
- Exact tokenization for GPT models
- WASM-based, fast execution
- ~2MB package size

### gpt-tokenizer (Alternative)
- Pure JS, smaller bundle
- Good enough for estimation
- Works offline

### Strategy:
- Use provider-specific counting when available (Anthropic API, Google countTokens)
- Use tiktoken for OpenAI
- Use gpt-tokenizer as fallback for local models
- Real-time counting happens on input change (debounced 100ms)

---

## 4. Storage: SQLite via better-sqlite3

### Why SQLite:
- Zero configuration, single-file database
- Synchronous API (better-sqlite3) — no callback hell
- Supports concurrent reads, serialized writes
- Perfect for single-user desktop application
- WAL mode for concurrent read/write performance
- Full SQL query capability for session search

### Schema Approach:
- Sessions table (id, created, last_active, profile, provider, model, status)
- Messages table (id, session_id, role, content, tokens, tool_calls, timestamp)
- Permissions table (id, session_id, tool_id, scope, decision, timestamp)
- TokenLog table (session_id, input_tokens, output_tokens, timestamp)

### Performance:
- Prepared statements for all queries
- Indexes on session_id, timestamp
- WAL mode enabled
- Periodic VACUUM for file size management

---

## 5. Configuration Management

### conf (v13+)
- JSON configuration with dot-notation access
- Schema validation via Zod
- XDG-compliant paths by default
- Atomic writes (no corruption on crash)
- Encryption support for sensitive values

### Credential Storage:
- **macOS**: Keychain via `keytar` or `security` CLI
- **Linux**: libsecret (GNOME Keyring/KWallet)
- **Windows**: Windows Credential Manager
- **Fallback**: Encrypted file with machine-specific key

---

## 6. Build & Bundle: tsup

### Why tsup:
- Built on esbuild (extremely fast)
- TypeScript support out-of-box
- Tree shaking for smaller bundles
- Multiple output formats (CJS + ESM)
- Declaration file generation
- Watch mode for development

### Build Strategy:
- Each package builds independently
- `cli` package bundles to single executable entry
- `engine` and `shared` build as library packages
- `tui` bundles with all React Ink dependencies

---

## 7. Telegram Integration

### node-telegram-bot-api (v0.66+)
- Long polling and webhook modes
- Inline keyboards for permission prompts
- Markdown message formatting
- File sending capability
- Message editing for live updates

### Integration Architecture:
- Telegram bot runs as background service within the agent process
- Messages bridge to the same Engine layer as TUI
- Session context shared between TUI and Telegram
- Permission prompts sent as inline keyboard messages
- Long-running operations show "typing..." indicator

---

## 8. Docker Strategy

### Multi-stage Build:
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
# Install pnpm, copy source, build all packages

# Stage 2: Production
FROM node:20-alpine AS production
# Copy built artifacts only, minimal image
# ENTRYPOINT ["node", "packages/cli/dist/index.js"]
```

### Considerations:
- Alpine base for minimal image size (~150MB target)
- Non-root user for security
- Volume mounts for data persistence
- Environment variables for configuration
- TTY allocation required for TUI mode (`docker run -it`)

---

## 9. Testing Strategy

### Unit Tests (Vitest):
- Provider mocking for AI calls
- Tool execution in sandbox
- Token counting accuracy
- Session state management
- Command parsing

### Integration Tests:
- Full setup wizard flow (mocked provider)
- Session create → interact → persist → restore
- Tool execution pipeline with permissions
- Secret Sauce summarization

### TUI Tests (ink-testing-library):
- Component rendering verification
- Input handling (key events)
- Animation frame verification
- Screen transitions
- Command list filtering

### E2E Tests:
- Full installation → first run → interaction flow
- Session persistence across process restarts
- Scope boundary enforcement

---

## 10. Competitive Analysis

### Hermes Agent (Reference)
- ASCII art banner with model info
- Two-panel layout (tools/skills + main area)
- Amber/gold color scheme on dark background
- Session info in status bar
- Slash command dropdown with filtering
- Multiple tool categories displayed on welcome

### Claude Code (by Anthropic)
- React Ink based
- Minimal UI, conversation-focused
- Tool execution with permission prompts
- Git-aware context

### Key Differentiators for Agent-X:
1. **Profile system** — No competitor has persona-switching
2. **Secret Sauce** — Memory, diary, identity evolution
3. **Visual richness** — Animations, gradients, multi-stage loaders
4. **Tool breadth** — Document/spreadsheet/PDF generation
5. **Multi-channel** — TUI + Telegram + Web-UI from same engine
6. **Session continuity** — Full context restoration across sessions

---

## 11. Color Scheme & Visual Design

Based on Hermes Agent reference image:

```typescript
const theme = {
  primary: '#FFB800',      // Amber/Gold (titles, highlights)
  secondary: '#FF8C00',    // Dark orange (accents)
  background: '#1A1A1A',   // Near-black background
  surface: '#2A2A2A',      // Slightly lighter for panels
  text: '#E0E0E0',         // Light gray for body text
  textMuted: '#808080',    // Dimmed text
  success: '#00FF88',      // Green (success indicators)
  error: '#FF4444',        // Red (errors)
  warning: '#FFAA00',      // Orange (warnings)
  info: '#4488FF',         // Blue (informational)
  border: '#444444',       // Border color
  inputBg: '#333333',      // Input field background
  highlight: '#FFB800',    // Selected item highlight
};
```

### Banner Style:
- Large ASCII art text (figlet/ink-big-text) with gradient
- Amber-to-orange gradient on banner text
- Version, provider, model, session info below banner
- Available tools/skills summary on welcome screen

---

## 12. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| React Ink performance with complex layouts | High | Incremental rendering, memoization, profiling |
| Token counting accuracy across providers | Medium | Provider-specific tokenizers, generous buffers |
| SQLite concurrent access from Telegram + TUI | Medium | WAL mode, serialized writes, read concurrency |
| Secret Sauce token budget exceeding context | High | Smart truncation, recency weighting, summarization |
| Provider API changes breaking integrations | Medium | Abstraction layer, SDK pinning, integration tests |
| Terminal compatibility across platforms | Medium | Test on iTerm2, Terminal.app, Windows Terminal, Alacritty |
| Large session history impacting performance | Low | Pagination, lazy loading, archival strategy |
