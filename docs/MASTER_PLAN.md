# Agent-X v0.4.0 — Agentic Intelligence Overhaul

> **Core Moto**: Achieve maximum output with minimum tokens through smart prompting, intelligent tool orchestration, and autonomous agent collaboration.

---

## 1. Architectural Pillars

### Pillar A: Foundation — Context & Memory
| Feature | Current | Target |
|---------|---------|--------|
| Memory | File-based JSON snippets | Vector + episodic + working memory |
| Context Window | Unbounded growth | Auto-compaction with summaries |
| RAG | Manual API only | Auto-queried before every response |
| System Prompt | Static concatenation | Dynamic, token-budgeted, task-aware |

### Pillar B: Intelligence — Smart Prompting & Reasoning
| Feature | Current | Target |
|---------|---------|--------|
| Prompt Strategy | Single-shot with tools | Chain-of-thought + ReAct + Plan-then-Execute |
| Token Efficiency | Full tool list every call | Dynamic tool selection via intent classifier |
| Model Routing | Manual | Auto-select by task (code→fast, analysis→reasoning) |
| Self-Correction | None | Retry with reflection on tool failure |

### Pillar C: Chat — Rich Interactive Experience
| Feature | Current | Target |
|---------|---------|--------|
| Tool Display | Plain text rows | Animated cards with live output streaming |
| Timing | Single elapsed time | Per-iteration timing, token-rate metrics |
| Clarification | Inline text | Structured Q&A with options + freeform |
| Message Branching | TUI only | Web-UI checkpoint/rewind/fork |
| Streaming | WS only | WS + SSE fallback + resumption |

### Pillar D: Agentic — Multi-Agent Collaboration
| Feature | Current | Target |
|---------|---------|--------|
| Subagents | Text-only background tasks | Full Agent instances with own tools + memory |
| Communication | Fire-and-forget | Message bus with publish/subscribe |
| Orchestration | Manual plan creation | Auto-decomposition with dynamic replanning |
| Parallelism | None | Parallel tool calls + parallel subagent spawning |

### Pillar E: Bridge — Universal Presence
| Feature | Current | Target |
|---------|---------|--------|
| Platforms | Telegram (working), Discord/Slack/Email (stubs) | All 5 functional |
| Session Isolation | Shared global agent | Per-user, per-channel session isolation |
| Message Threading | Isolated | Thread-aware with continuity |

---

## 2. Implementation Phases

### Phase 1: Core Intelligence (Week 1)
**Goal**: Make the agent smarter, faster, and more interactive.

#### 1A. Smart System Prompting
- Implement `PromptEngine` that dynamically assembles system prompts based on:
  - Task type (detected from user message)
  - Available token budget
  - Conversation length (compact vs verbose mode)
  - Active crew specialties
- Add structured reasoning directives:
  - `REASONING_MODE`: quick | deep | creative
  - `TOOL_STRATEGY`: minimal | aggressive | confirm-each
  - `OUTPUT_FORMAT`: concise | detailed | structured
- Token-efficient tool description: only include tools relevant to detected intent

#### 1B. Subagent with Full Tool Access
- Refactor `SubAgentManager` to create full `Agent` instances (not raw LLM calls)
- Each subagent gets:
  - Own `Agent` with `ToolExecutor`, `PermissionManager`, `MemoryManager`
  - Isolated session directory
  - Access to parent agent's read-only memory
  - Event stream back to parent via callback
- Implement `agent_delegation` tool that lets the main agent spawn subagents with specific missions
- Parent agent receives subagent results and synthesizes final response

#### 1C. RAG Auto-Query in Chat
- Before every `sendMessage()`, automatically query RAG index with user message
- Inject top-k retrieved chunks into system context as `relevant_documents`
- Add `rag_search` tool so the agent can also do targeted searches mid-conversation
- Show retrieved sources in Web-UI as citation chips

#### 1D. Clarifying Question Flow
- New WebSocket event type: `clarification_required`
- Agent can emit structured clarifications with:
  - `question`: text to show user
  - `options`: array of choices (can be empty for freeform)
  - `allowFreeform`: boolean
- Web-UI shows modal/dropdown with options + text input
- User response sent as `clarification_response` event
- Agent continues from where it left off

#### 1E. Rich Tool Visualization
- Redesign `Chat.tsx` tool rendering:
  - Tool call card: tool name, arguments (collapsible JSON), start time
  - Live output stream: for `shell_exec_streaming`, show output in real-time
  - Tool result card: success/failure badge, elapsed ms, token cost, output (collapsible)
  - Tool chain graph: when multiple tools run in sequence, show as a timeline
- Add `tool_stream_output` WebSocket event for live shell output

#### 1F. Conversation Compaction
- Track token count of `Agent.messages` array
- When approaching 70% of model context window:
  1. Summarize oldest messages into a `summary` message
  2. Keep last N full messages for recency
  3. Emit `context_compacted` event to UI
- Configurable compaction strategy per model

### Phase 2: Multi-Agent Mesh (Week 2)
**Goal**: Agents that talk to each other and work in parallel.

- **Agent Message Bus**: Pub/sub system where agents can publish and subscribe to topics
- **Specialist Registry**: Register agents by specialty (code, research, testing, docs)
- **Auto-Decomposition**: When user asks a complex task, main agent breaks it into subtasks and delegates to specialists in parallel
- **Result Synthesis**: Parent agent merges subagent results using a synthesis prompt
- **Crew-as-Team**: A crew becomes a team of agents, not just a persona

### Phase 3: Bridge Hardening (Week 3)
**Goal**: Agent-X lives everywhere, with full session isolation.

- **Discord Bridge**: Implement full Discord.js bot with slash commands, threads, DMs
- **Slack Bridge**: Implement Slack Bolt app with Socket Mode, interactive blocks
- **Email Bridge**: Implement IMAP polling + SMTP sending with thread detection
- **Per-User Session Isolation**: Each bridge user gets their own session ID, crew, and memory context
- **Bridge-Aware Tooling**: Tools know which platform they're running on and format output accordingly

### Phase 4: Advanced Reasoning (Week 4)
**Goal**: Deep reasoning, planning, and self-improvement.

- **Tree of Thoughts**: For complex decisions, explore multiple reasoning paths in parallel
- **Skill Auto-Generation**: When agent solves a novel problem, auto-generate a reusable skill
- **Reflection Loop**: After task completion, agent reflects on what worked/didn't and updates its own system prompt
- **Research Mode**: Batch trajectory generation with parallel search agents

---

## 3. Technical Implementation Notes

### Token Budget System
```
Total Context Window: 128K (model-dependent)
├─ System Prompt: 2K-8K (dynamic)
├─ Relevant Documents (RAG): 0-4K
├─ Working Memory: 1K-2K
├─ Recent Conversation: 50K-100K
├─ Tool Results Buffer: 10K
└─ Reserved for Response: 20K-40K
```

### Event Flow: Subagent Delegation
```
User: "Refactor the auth module and write tests"
  ↓
Main Agent detects multi-step task
  ↓
Spawns Subagent-A: "Refactor auth module" (tools: code_replace, code_search)
Spawns Subagent-B: "Write unit tests for auth" (tools: code_search, test_create)
  ↓ (parallel)
Subagent-A completes → returns diff + summary
Subagent-B completes → returns test files + coverage
  ↓
Main Agent synthesizes: "Done. Here's what changed and the test coverage."
```

### Clarification Flow
```
User: "Deploy the app"
  ↓
Agent: CLARIFICATION_REQUIRED
  question: "Which environment?"
  options: ["staging", "production"]
  allowFreeform: false
  ↓
Web-UI shows dropdown → User selects "staging"
  ↓
Agent continues with staging deployment
```

---

## 4. Success Metrics

| Metric | Baseline (v0.3.3) | Target (v0.4.0) |
|--------|-------------------|-----------------|
| Avg tokens per task | ~15K | ~8K (via smart prompting) |
| Tool call latency | ~3s (blocking) | ~1s (parallel + streaming) |
| Multi-step tasks | Sequential only | 3-5 parallel subagents |
| User clarification | Inline text | Structured <200ms response |
| Bridge platforms | 1 (Telegram) | 4 (Telegram, Discord, Slack, Email) |
| Context window exhaustion | ~20 messages | Auto-compact at 70% |
| RAG relevance | Manual | Auto-injected per query |

---

## 5. Files to Create/Modify

### New Files
- `packages/engine/src/prompt/PromptEngine.ts`
- `packages/engine/src/agent/AgentBus.ts`
- `packages/engine/src/agent/SmartSubAgent.ts`
- `packages/engine/src/session/ContextCompactor.ts`
- `packages/web-ui/src/components/ToolCard.tsx`
- `packages/web-ui/src/components/ClarificationModal.tsx`
- `packages/web-ui/src/components/AgentTimeline.tsx`

### Modified Files
- `packages/engine/src/agent/Agent.ts` — smart prompting, RAG injection, compaction
- `packages/engine/src/agent/SubAgentManager.ts` — full agent instances
- `packages/web-api/src/ws.ts` — clarification events, tool streaming
- `packages/web-ui/src/pages/Chat.tsx` — rich tool UI, clarification flow
- `packages/engine/src/secret-sauce/index.ts` — token budget management
- `packages/engine/src/tools/toolkit.ts` — dynamic tool selection
