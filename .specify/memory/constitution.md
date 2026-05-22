# Agent-X Project Constitution

## Governing Principles

### 1. User Experience Above All
- The TUI (Terminal User Interface) is the primary interface and MUST be world-class
- Every interaction must feel intentional, polished, and professional
- Animations are NOT decorative — they communicate system state and build trust
- Internal workings (AI calls, system prompts, MD files) are NEVER exposed to users
- Zero tolerance for raw AI model output reaching the UI layer

### 2. Architecture Integrity
- The system MUST support both TUI (React Ink) and Web-UI from a shared backend
- Separation of concerns: UI layer → Service layer → AI layer → Storage layer
- Every component must be independently testable and replaceable
- Model provider abstraction: switching between OpenAI/Anthropic/Google/Local MUST be seamless
- The "Secret Sauce" (SOUL, PROFILE, MEMORIES, DIARY, IDENTITY, PERMISSION) is a first-class architectural concern, not an afterthought

### 3. Security & Permission Model
- Agent operates ONLY within the scope folder where launched — no exceptions
- Permission system is granular: "allow once", "allow always", "deny"
- API keys and sensitive configuration are stored securely (never in plaintext logs)
- No tool execution without explicit or pre-granted permission
- Session isolation: one session cannot access another's permission state without explicit loading

### 4. Quality Standards
- TypeScript strict mode everywhere — no `any` types in production code
- Every component must have unit tests (vitest)
- Integration tests for all AI provider interactions (mocked)
- E2E tests for critical user journeys (setup wizard, session lifecycle, tool execution)
- Code coverage target: 85%+ for core modules
- Linting: ESLint + Prettier with zero warnings in CI

### 5. Performance Requirements
- TUI startup time: < 500ms to first interactive frame
- Input response latency: < 16ms (60fps rendering)
- Animation frame rate: 30fps minimum, 60fps target
- Session restore time: < 1s for loading previous session state
- Token counting: real-time, never blocking the UI thread
- Memory footprint: < 150MB RSS for idle agent

### 6. Versioning & Release Discipline
- Semantic versioning (SemVer) is mandatory on every release
- CHANGELOG.md maintained with every merge to main
- Git tags correspond to npm/brew/Docker releases
- No breaking changes without major version bump
- Feature flags for experimental capabilities

### 7. Extensibility & Plugin Architecture
- Tools are modular and self-describing (schema + handler + metadata)
- New tools can be added without modifying core
- Profile system allows unlimited persona definitions
- Model providers are plugins — new providers added without core changes
- Slash commands are registered dynamically

### 8. Developer Experience
- `agentx` CLI is the single entry point — no complex setup required
- First-run setup wizard handles ALL configuration
- Documentation is code-adjacent (JSDoc + README per module)
- Contributing guide with architecture decision records (ADRs)

### 9. Open Source & Community
- MIT License (or Apache 2.0 — finalize before v1.0)
- Public roadmap maintained in GitHub Projects
- Issue templates for bugs, features, and tool requests
- Community profiles/tools can be shared via a registry

### 10. Resilience & Error Handling
- Graceful degradation: if AI provider fails, inform user clearly — never crash
- Retry logic with exponential backoff for transient API failures
- Session state is auto-saved every 30 seconds and on graceful exit
- Crash recovery: last known good state is restorable
- All errors are logged with correlation IDs for debugging

---

## Decision Gates

These must be verified before any implementation proceeds:

| Gate | Criteria |
|------|----------|
| Complexity | No single module exceeds 500 LOC. Split if approaching |
| Dependencies | Every new dependency must be justified (size, maintenance, alternatives considered) |
| AI Calls | Every AI call must have a clear purpose documented. No speculative calls |
| UI Changes | Every UI element must be tested in 80-column and 120-column terminals |
| Security | Every tool must pass permission check before execution |
| Performance | Every new feature must not degrade startup time by >50ms |

---

## Technology Constraints

- **Runtime**: Node.js 20+ (LTS)
- **Language**: TypeScript 5.x (strict mode)
- **TUI Framework**: React Ink 7.x (latest)
- **Build**: tsup or esbuild for fast compilation
- **Package Manager**: pnpm (workspace support, strict dependency resolution)
- **Testing**: Vitest + ink-testing-library
- **Linting**: ESLint flat config + Prettier
- **CI/CD**: GitHub Actions
- **Container**: Docker multi-stage builds (Alpine)
