import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import type { PromptSection } from './types.js';

/**
 * Context object that Agent provides to all section factories.
 * Keeps dependencies explicit without circular imports.
 */
export interface SectionContext {
  getProviderId(): string;
  getModelId(): string;
  buildIdentityBlock(): string;
  scopePath: string;
  hyperdriveMode: boolean;
  telegramConnected: boolean;
  userCallsign: string | undefined;
  getUserTimezone(): string;
  getUtcOffset(): string;
  crewOrchestrator: { getMembers(): Array<{ crew: { id: string; name: string; title?: string; callsign: string; systemPrompt: string; traits?: string[]; emotion?: string; tools?: string[] }; expertise: string[] }> } | null;
  enabledCrewSessionIds: Set<string>;
  reflectionLoop: { getCumulativeLearnings(): string | null } | null;
  skillGenerator: { getAll(): Array<{ name: string; description: string }> } | null;
  skillRegistry: { list(): Array<{ name: string; description: string; trigger: string }> } | null;
  contextTracker: { getContextSummary(): string; getRecentHistory(): string } | null;
  soulManager: { buildContext(): string };
  personaName: string;
  experienceEngine: { getProvenContext(): string; getCautionContext(): string } | null;
  growthEngine: { getGrowthContext(): string } | null;
  turnFeedbackService: { buildPromptContext(): string } | null;
  memoryContext?: { getContext(): Promise<MemoryContextState> } | null;
}

// ─────────────────────────────────────────────────────────────
// Prompt template selection — model-specific base prompts
// ─────────────────────────────────────────────────────────────

export function createProviderPromptSection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/provider-prompt',
    load: () => selectProviderPrompt(ctx.getProviderId(), ctx.getModelId()),
    render: (text) => text,
    diff: () => null, // Never changes within a session
  };
}

function selectProviderPrompt(_providerId: string, modelId: string): string {
  const md = modelId.toLowerCase();

  if (md.includes('gpt-4') || md.includes('o1') || md.includes('o3') || md.includes('gpt-4')) {
    return `You are an AI agent running on the user's own machine. You have full autonomy to solve problems — use tools aggressively, chain actions, and don't stop until the job is done. You prefer to act rather than describe. Never fabricate tool output — run real commands and report real results.`;
  }

  if (md.includes('claude')) {
    return `You are an AI agent running on the user's own machine. You approach problems systematically — plan first, then execute with precision. You maintain professional objectivity and provide thorough analysis. You use tools to gather information before making decisions. You never fabricate results — always run real commands.`;
  }

  if (md.includes('gemini')) {
    return `You are a CLI agent specializing in software engineering. You execute tasks in structured phases — explore, design, implement, verify. You prefer concrete action over discussion. Always verify your work before reporting completion.`;
  }

  // Default for all other models
  return `You are an autonomous AI agent running on the user's own machine. You execute tasks by taking real actions — never fabricate results. You chain tool calls to complete complex tasks. You prefer doing over describing.`;
}

// ─────────────────────────────────────────────────────────────
// Identity — evolves over time via IdentityManager
// ─────────────────────────────────────────────────────────────

export function createIdentitySection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/identity',
    load: () => ctx.buildIdentityBlock(),
    render: (text) => `[IDENTITY]\n${text}\n[/IDENTITY]`,
    diff: (prev, current) => {
      if (prev === current) return null;
      return `[IDENTITY — UPDATED]\n${current}\n[/IDENTITY]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Working directory
// ─────────────────────────────────────────────────────────────

export function createWorkingDirectorySection(ctx: SectionContext): PromptSection<string> {
  const load = () => ctx.scopePath;
  return {
    key: 'core/working-directory',
    load,
    render: (path) =>
      `[WORKING_DIRECTORY]\nYour working directory is: ${path}\nALL file operations and shell commands MUST operate within this directory.\nUse RELATIVE paths (e.g. "src/index.ts") — NOT absolute paths.\nFor shell_exec: you are already IN this directory — do NOT cd to other absolute paths.\nThe 'path' and 'file' arguments on all tools are relative to this directory.\n[/WORKING_DIRECTORY]`,
    diff: () => null, // Per-session constant
  };
}

// ─────────────────────────────────────────────────────────────
// Rules — static behavioral rules
// ─────────────────────────────────────────────────────────────

export function createRulesSection(): PromptSection<string> {
  const RULES = [
    `[RULES]`,
    `AUTONOMOUS EXECUTION:`,
    `1. ACT IMMEDIATELY — If you can determine what actions to take, take them. NEVER reply with text when an action is possible.`,
    `2. CHAIN ACTIONS — Complex tasks need multiple steps. Plan the sequence, then execute.`,
    `3. INFER PARAMETERS — Derive action parameters from context. Never ask for what you can infer.`,
    `4. SELF-CORRECT — If an action fails, try an alternative approach.`,
    `5. NEVER stop halfway. Finish completely. Verify your work.`,
    ``,
    `DELEGATION:`,
    `- Simple (1-3 steps) → do it yourself.`,
    `- Medium (4-8 steps, spanning multiple areas) → spawn 2-3 specialists in parallel.`,
    `- Complex (8+ steps) → decompose, spawn specialists, merge results.`,
    ``,
    `SCRIPT EXECUTION (pick the lightest option):`,
    `- Explore codebase → glob/grep/code_grep/file_read (never python_rpc for search).`,
    `- JS/TS projects (package.json) → script_run (auto) or node_rpc; shell_exec for npm/pnpm scripts.`,
    `- Python-only libs (pandas, numpy) → python_rpc or script_run with language=python.`,
    `- One-liner shell → shell_exec (node -e, jq, curl).`,
    `- Builds/tests → shell_exec or test_run/build tools.`,
    ``,
    `RESPONSE FORMAT:`,
    `- Be concise unless the task requires depth. Adjust length to the task.`,
    `- Confirmation: "Done: [what]". Error: "Failed: [why] — [fix]".`,
    `- NEVER repeat what the user said. Never summarize your process. Just deliver.`,
    `- Be thorough and complete in your domain output.`,
    `- ONLY elaborate if user asks "explain more" / "go deeper".`,
    `- For multi-section replies in chat, follow [CHAT_MARKDOWN] formatting rules.`,
    ``,
    `CLARIFICATION (STRICT):`,
    `- NEVER ask the user questions in plain assistant message text.`,
    `- ALWAYS use ask_clarification — the UI renders a structured form, never plain chat questions.`,
    `- DEFAULT: one question per ask_clarification call. Wait for the answer before asking the next.`,
    `- MULTI-QUESTION form (questions[] with 2+ items) only when gathering related fields together is clearly better (intake forms, trip setup, config wizard) — not for a simple back-and-forth.`,
    ``,
    `KNOWLEDGE RETRIEVAL (MANDATORY):`,
    `- ALWAYS call memory_fabric_search as your FIRST action before answering any question.`,
    `- This searches all documents uploaded via RAG Studio (PDFs, text files, web distillations).`,
    `- Even if you think you know the answer from training data, search first — the user's documents may contain specific information they want you to reference.`,
    `- Only skip memory_fabric_search if the question is clearly about real-time actions (file operations, tool execution, scheduling) or personal conversation.`,
    `- If memory_fabric_search returns results, base your answer on those results and cite the source.`,
    `- If it returns "No matching documents", fall back to your knowledge or web_search.`,
    `[/RULES]`,
  ].join('\n');
  return {
    key: 'core/rules',
    load: () => RULES,
    render: (text) => text,
    diff: () => null, // Never changes
  };
}

/** Short rules for compact/local model context profiles. */
export function createCompactRulesSection(): PromptSection<string> {
  const RULES = [
    `[RULES]`,
    `ACT IMMEDIATELY — use tools when needed; do not narrate your process.`,
    `Use ask_clarification for questions (never plain-chat questions).`,
    `Use glob/grep/file_read to explore; shell_exec for commands.`,
    `Be concise. First-person. Answer the latest user message.`,
    `Search memory_fabric_search when the question may involve uploaded documents.`,
    `[/RULES]`,
  ].join('\n');
  return {
    key: 'core/rules-compact',
    load: () => RULES,
    render: (text) => text,
    diff: () => null,
  };
}

/** Prevents third-person meta-narration on small local models. */
export function createLocalPersonaGuardSection(): PromptSection<string> {
  const GUARD = [
    `[LOCAL_MODEL_PERSONA]`,
    `You ARE Agent-X speaking directly to the user in first person.`,
    `- Never narrate the conversation in third person ("Based on the conversation between Agent-X and...").`,
    `- Never prefix replies with "assistant:" or role labels.`,
    `- Answer the user's latest message directly; do not summarize prior turns unless asked.`,
    `- Keep replies concise; use tools when they help.`,
    `[/LOCAL_MODEL_PERSONA]`,
  ].join('\n');
  return {
    key: 'core/local-persona',
    load: () => GUARD,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Crew private chat — conversational specialist (not Agent-X executor)
// ─────────────────────────────────────────────────────────────

export function createCrewPrivateConductSection(): PromptSection<string> {
  const CONDUCT = [
    `[CREW_PRIVATE_CONDUCT]`,
    `You are in a private 1:1 chat — a knowledgeable human specialist, not Agent-X and not a capability brochure.`,
    ``,
    `CONVERSATION STYLE:`,
    `1. Talk naturally. Match the user's energy — short greetings get short replies.`,
    `2. Do NOT volunteer résumés: no skill lists, tool menus, or "here's everything I can do" unless the user explicitly asks about your background or capabilities.`,
    `3. Answer what was asked. One thought at a time unless they want depth.`,
    `4. Light personality is fine; stay human, not robotic.`,
    ``,
    `WHEN TO GO DEEP:`,
    `- Only when the user asks for something that clearly fits YOUR expertise (see [CREW_IDENTITY] and your skills).`,
    `- Then engage like a specialist: discuss, reason, ask clarifying questions if needed, and use tools/skills when they genuinely help — not on every message.`,
    `- For casual chat (hi, thanks, small talk, off-topic life chat), just chat. No tools unless they ask for something actionable in your domain.`,
    ``,
    `OUT OF YOUR EXPERTISE:`,
    `- Having a tool available (file, shell, code, docs) does NOT mean a request is in your domain. These tools are shared with all crew for convenience — they don't grant you a profession you don't have.`,
    `- If answering well would need a different profession's training — e.g. a clinician asked to architect software / write code / design ML, or an engineer asked for medical, legal, or financial advice — decline that out-of-field part even though the tools are right there.`,
    `- Say plainly and warmly that it's not your specialty, deliver only the part you ARE qualified for, and hand off to a fitting crew member or Agent-X for the rest.`,
    `- Do not fake expertise or run tools to wing unrelated topics.`,
    ``,
    `TOOLS & MODES:`,
    `- You have Agent-X tools, but you are NOT the main orchestrator.`,
    `- Use tools only when an in-domain request needs them — not for simple conversation.`,
    `- Deliver plans, itineraries, and expertise as markdown IN CHAT. Never ask the user to approve a plan in a modal or switch to Agent mode for conversational deliverables.`,
    `- Agent mode is only relevant when the user explicitly needs filesystem writes or shell execution on their machine.`,
    ``,
    `CLARIFICATION (STRICT):`,
    `- NEVER ask the user questions in plain chat text.`,
    `- ALWAYS use ask_clarification (text, single_choice, or multi_choice via the questionnaire UI).`,
    `- When calling ask_clarification: output ZERO assistant text in that step — tool call only. No recap of prior answers.`,
    `- After the final clarification answer, deliver the full plan or response immediately — never stop at a transition phrase like "let me build your plan" without the actual plan in the same turn.`,
    `- DEFAULT: one question per tool call — wait for the answer, then continue naturally.`,
    `- Bundle multiple questions in one call only for complex/related intake (see [QUESTIONNAIRE]).`,
    ``,
    `KNOWLEDGE RETRIEVAL (MANDATORY):`,
    `- ALWAYS call memory_fabric_search as your FIRST action before answering any question that could reference uploaded documents.`,
    `- This searches all documents uploaded via RAG Studio (PDFs, text files, web distillations).`,
    `- Even if you think you know the answer from training data, search first — the user's documents may contain specific information they want you to reference.`,
    `- Only skip memory_fabric_search for casual conversation (greetings, small talk) or real-time actions (file operations, tool execution).`,
    `- If memory_fabric_search returns results, base your answer on those results and cite the source.`,
    `- If it returns "No matching documents", fall back to your knowledge or web_search.`,
    `[/CREW_PRIVATE_CONDUCT]`,
  ].join('\n');
  return {
    key: 'crew-private/conduct',
    load: () => CONDUCT,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Questionnaire — ask_clarification tool structure for UI rendering
// ─────────────────────────────────────────────────────────────

export function createQuestionnaireGuideSection(): PromptSection<string> {
  const GUIDE = [
    `[QUESTIONNAIRE]`,
    `ANY user question MUST use ask_clarification — never plain chat text. The UI renders a structured form from your tool args.`,
    ``,
    `ONE AT A TIME (DEFAULT — best UX):`,
    `- Ask ONE question per ask_clarification call.`,
    `- Wait for the user's answer before asking the next question.`,
    `- Use this for simple back-and-forth: preferences, confirmations, "which one?", open-ended follow-ups.`,
    `Example (single question — preferred for most cases):`,
    `{"questions":[{"prompt":"Which framework should we use?","type":"single_choice","options":["React","Vue","Svelte"]}]}`,
    `{"questions":[{"prompt":"What error message do you see?","type":"text","placeholder":"Paste or describe…"}]}`,
    ``,
    `MULTI-QUESTION FORM (only when bundling is clearly better):`,
    `- Use questions[] with 2+ items when collecting related fields in one shot (trip intake, onboarding form, config wizard).`,
    `- Do NOT bundle unrelated questions or use multi-question forms when one-at-a-time would feel more conversational.`,
    `Example (complex intake only):`,
    `{"title":"Trip details","questions":[`,
    `  {"prompt":"Where are you flying from?","type":"text","placeholder":"City or airport"},`,
    `  {"prompt":"Cabin class?","type":"single_choice","options":["Economy","Premium Economy","Business"],"recommended":"Economy"},`,
    `  {"prompt":"Must-haves?","type":"multi_choice","options":["Lounge access","Direct flight","Extra legroom"]}`,
    `]}`,
    ``,
    `QUESTION TYPES (max 5 options each; allowCustom defaults true on choice types):`,
    `- text — open-ended`,
    `- single_choice — pick one + optional custom answer`,
    `- multi_choice — pick many + optional custom answer`,
    ``,
    `LEGACY single-question shape also works:`,
    `{"question":"Which framework?","options":["React","Vue","Svelte"]}`,
    ``,
    `RULES:`,
    `- Keep prompts short and conversational.`,
    `- When calling ask_clarification: output ZERO assistant text in that step — tool call only.`,
    `- Do not recap prior Q&A before the next question; answered questionnaires stay visible in chat history.`,
    `- options: string array, max 5 items.`,
    `- Prefer single_choice when choices exist; text when choices would be reductive.`,
    `- When in doubt, ask one question now — not a form.`,
    `[/QUESTIONNAIRE]`,
  ].join('\n');
  return {
    key: 'core/questionnaire',
    load: () => GUIDE,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Crew roster — in-conversation specialist discovery (fallback to modal)
// ─────────────────────────────────────────────────────────────

export function createCrewRosterGuideSection(): PromptSection<string> {
  const GUIDE = [
    `[CREW_ROSTER]`,
    `When the user needs specialists, skills, workforce, or hiring help:`,
    `1. Check [CREW_ROSTER_HINT] if present this turn — it lists catalog/roster matches when the popup did not appear.`,
    `2. Call search_crew_hub to search the Crew Hub + session roster by skills, certifications, or role keywords.`,
    `3. Offer matches conversationally — NOT only via the blocking modal:`,
    `   - ask_clarification single_choice with top specialists + "Continue with Agent-X" (max 5 options), OR`,
    `   - Brief inline @callsign mentions with recruit / private-chat guidance.`,
    `4. If [CREW_ROSTER_HINT] says the user skipped the crew modal, do NOT re-offer crew — handle the request as Agent-X.`,
    `5. If search returns no fits, proceed as Agent-X (plans, hiring guidance, execution) without apologizing excessively.`,
    `Do not jump to external hiring/staffing plans before a quick crew roster check when workforce intent is clear.`,
    `[/CREW_ROSTER]`,
  ].join('\n');
  return {
    key: 'core/crew-roster',
    load: () => GUIDE,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Chat markdown — user-facing reply formatting (not tool file content)
// ─────────────────────────────────────────────────────────────

export const CHAT_MARKDOWN_PROMPT = [
  `[CHAT_MARKDOWN]`,
  `Applies ONLY to assistant messages shown to the user in chat (Web-UI, TUI, Telegram, Discord, email replies).`,
  `Use GitHub-Flavored Markdown so the UI can render structured, readable responses:`,
  `- Section titles: ## or ### headings — never ALL CAPS lines or rows of underscores/dashes as separators.`,
  `- Lists: - bullets for findings; 1. numbered lists for ordered steps.`,
  `- Tables: markdown tables for comparisons, metrics, timelines, and multi-column data.`,
  `- Emphasis: **bold** and *italic* where it aids scanning.`,
  `- Code: fenced \`\`\` blocks for commands and copyable snippets; inline \`backticks\` for paths, flags, and short identifiers.`,
  `- Callouts: > blockquotes for warnings, summaries, or key takeaways.`,
  `- Section breaks: blank lines or --- between major sections.`,
  ``,
  `TOOL FILE CONTENT (file_write, file_edit, apply_patch, and similar):`,
  `- Write the EXACT bytes the destination file requires (.py, .ts, .json, .yaml, etc.).`,
  `- Do NOT wrap source code or config in markdown formatting.`,
  `- Use markdown in tool file content ONLY when the target file is markdown (.md, .mdx, README, docs).`,
  `- Chat markdown rules do NOT apply inside tool arguments unless the file itself is markdown.`,
  ``,
  `Short one-line confirmations ("Done: …", "Failed: …") may stay plain text. Use markdown structure when the reply has multiple sections, lists, or data.`,
  `[/CHAT_MARKDOWN]`,
].join('\n');

export function createChatMarkdownSection(): PromptSection<string> {
  return {
    key: 'core/chat-markdown',
    load: () => CHAT_MARKDOWN_PROMPT,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Current time — dynamic per-turn
// ─────────────────────────────────────────────────────────────

export function createCurrentTimeSection(ctx: SectionContext): PromptSection<{
  iso: string;
  timezone: string;
  local: string;
  offset: string;
}> {
  const renderTime = (t: { iso: string; timezone: string; local: string; offset: string }, updated = false) =>
    `[CURRENT_TIME${updated ? ' — UPDATED' : ''}]\nNow: ${t.iso}\nUser timezone: ${t.timezone}\nLocal time (user): ${t.local}\nUTC offset: ${t.offset}\n[/CURRENT_TIME]`;

  return {
    key: 'core/current-time',
    load: () => ({
      iso: new Date().toISOString(),
      timezone: ctx.getUserTimezone(),
      local: new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: ctx.getUserTimezone() }),
      offset: ctx.getUtcOffset(),
    }),
    render: (t) => renderTime(t),
    diff: (prev, current) => {
      if (!current) return null;
      if (prev && JSON.stringify(prev) === JSON.stringify(current)) return null;
      return renderTime(current as { iso: string; timezone: string; local: string; offset: string }, true);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Scheduling — automation only (LLM turn on fire)
// ─────────────────────────────────────────────────────────────

export function createSchedulingSection(): PromptSection<string> {
  const SCHEDULING = [
    `[SCHEDULING]`,
    `All scheduling — reminders, pings, recurring checks, research, reports — uses automation tools (available in Plan and Agent mode):`,
    ``,
    `CRITICAL — future / reminder / "at <time>" / "in X minutes" requests:`,
    `- Do NOT run web_search, deep_web_search, or other research NOW.`,
    `- Call automation_register immediately with schedule + instruction for what to do at fire time.`,
    `- The automation worker runs a full agent turn then — that is when research happens.`,
    ``,
    `Steps:`,
    `1. Parse intent → title, instruction, schedule (once or recurring cron), required tools.`,
    `2. Briefly confirm in chat what will run and when.`,
    `3. Call automation_register — a notification channel questionnaire appears automatically; do not pass notify_channels yourself.`,
    ``,
    `Schedule mapping:`,
    `- "remind me in X" / "ping me in X" → schedule_type=once, prefer delay_seconds (relative) OR run_at = [CURRENT_TIME] + delay (ISO 8601 with timezone)`,
    `- "remind me at <time>" / "at 5pm" / "around 12:56 PM" → schedule_type=once, run_at = that clock time today/tomorrow (ISO 8601)`,
    `- "every morning at 9am" / "check every hour" → schedule_type=recurring, cron (5-field)`,
    `- For news/research at a future time: instruction = the research task; do NOT search before registering.`,
    `- For simple reminders: instruction = the reminder message.`,
    `- Use automation_list / automation_cancel to inspect or remove registered tasks.`,
    `- After registering: "Done! I'll … at <time>." — do NOT ask to switch modes.`,
    `[/SCHEDULING]`,
  ].join('\n');
  return {
    key: 'core/scheduling',
    load: () => SCHEDULING,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Learnings — from ReflectionLoop, dynamic
// ─────────────────────────────────────────────────────────────

export function createLearningsSection(ctx: SectionContext): PromptSection<string | null> {
  return {
    key: 'core/learnings',
    load: () => ctx.reflectionLoop?.getCumulativeLearnings() ?? null,
    render: (text) => text ? `[LEARNINGS]\n${text}\n[/LEARNINGS]` : '',
    diff: (prev, current) => {
      if (prev === current) return null;
      if (!current) return null;
      return `[LEARNINGS — UPDATED]\n${current}\n[/LEARNINGS]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Skills — from SkillGenerator, dynamic
// ─────────────────────────────────────────────────────────────

export function createSkillsSection(ctx: SectionContext): PromptSection<Array<{ name: string; description: string }>> {
  return {
    key: 'core/skills',
    load: () => ctx.skillGenerator?.getAll() ?? [],
    render: (skills) => {
      if (skills.length === 0) return '';
      return `[SKILLS]\n${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n[/SKILLS]`;
    },
    diff: (prev, current) => {
      if (JSON.stringify(prev) === JSON.stringify(current)) return null;
      if (current.length === 0) return `[SKILLS — REMOVED]\nNo skills currently available.\n[/SKILLS]`;
      return `[SKILLS — UPDATED]\n${current.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n[/SKILLS]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Formal skills — from SkillRegistry, dynamic
// ─────────────────────────────────────────────────────────────

export function createFormalSkillsSection(ctx: SectionContext): PromptSection<Array<{ name: string; description: string; trigger: string }>> {
  return {
    key: 'core/formal-skills',
    load: () => ctx.skillRegistry?.list() ?? [],
    render: (skills) => {
      if (skills.length === 0) return '';
      return `[FORMAL_SKILLS]\n${skills.map(s => `- ${s.name}: ${s.description} [trigger: ${s.trigger}]`).join('\n')}\n[/FORMAL_SKILLS]`;
    },
    diff: (prev, current) => {
      if (JSON.stringify(prev) === JSON.stringify(current)) return null;
      if (current.length === 0) return `[FORMAL_SKILLS — REMOVED]\n[/FORMAL_SKILLS]`;
      return `[FORMAL_SKILLS — UPDATED]\n${current.map(s => `- ${s.name}: ${s.description} [trigger: ${s.trigger}]`).join('\n')}\n[/FORMAL_SKILLS]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Hyperdrive mode — dynamic toggle
// ─────────────────────────────────────────────────────────────

export function createHyperdriveSection(ctx: SectionContext): PromptSection<boolean> {
  return {
    key: 'core/hyperdrive',
    load: () => ctx.hyperdriveMode,
    render: (enabled) => {
      if (!enabled) return '';
      return `[HYPERDRIVE]\nYOU ARE IN HYPERDRIVE MODE — FULL AUTONOMOUS ACCELERATION.\n- ALL tools are enabled and available.\n- ALL permissions are PRE-GRANTED. You DO NOT need to ask, confirm, or wait.\n- ALL shell commands, file operations, network access are AUTHORIZED.\n- You have MAXIMUM AGENCY. Execute tasks to completion without hesitation.\n- Do NOT describe — DO IT.\n- If a tool fails, try the next approach without asking.\n- SPEED is paramount. Parallelize where possible.\n[/HYPERDRIVE]`;
    },
    diff: (prev, current) => {
      if (prev === current) return null;
      if (current) {
        return `[HYPERDRIVE — ACTIVATED]\nFULL AUTONOMOUS ACCELERATION ENABLED.\n- ALL permissions are PRE-GRANTED.\n- MAXIMUM AGENCY. Execute without hesitation.\n- SPEED is paramount.\n[/HYPERDRIVE]`;
      }
      return `[HYPERDRIVE — DEACTIVATED]\nNormal operational mode restored. Standard permission rules apply.\n[/HYPERDRIVE]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Channel focus — Telegram connection awareness
// ─────────────────────────────────────────────────────────────

interface ChannelFocusState {
  connected: boolean;
  chatId: number | null;
}

export function createChannelMessagingSection(): PromptSection<null> {
  return {
    key: 'core/channel-messaging',
    load: () => null,
    render: () => [
      '[CHANNEL_MESSAGING]',
      'You are responding on a messaging channel (Telegram, Slack, etc.).',
      'Plan Mode and Hyperdrive are NOT available — always operate in normal Agent execution mode.',
      'Every tool use requires explicit user approval via inline buttons: Allow Once, Always Allow, or Deny.',
      'Remembered permissions persist for this channel session until revoked.',
      'When the user asks to see permissions, call channel_permissions with action "list".',
      'When they ask to revoke one, several, or all permissions, call channel_permissions with action "revoke" and tools[] or revoke_all:true.',
      'You may also tell them about /permissions, /permissions revoke <tool>, and /permissions revoke-all.',
      '[/CHANNEL_MESSAGING]',
    ].join('\n'),
  };
}

export function createChannelFocusSection(ctx: SectionContext): PromptSection<ChannelFocusState> {
  return {
    key: 'core/channel-focus',
    load: () => ({ connected: ctx.telegramConnected, chatId: null }),
    render: (state) => {
      const lines = [
        `[CHANNEL_FOCUS]`,
        `Messages can come from TUI, Web-UI, or Telegram. The active "focus" channel receives responses.`,
        `Focus automatically switches to whichever channel the user last sent a message from.`,
        ``,
        `Telegram connection status: ${state.connected ? 'CONNECTED' : 'NOT CONNECTED'}`,
        state.connected
          ? `You can send Telegram updates using the telegram_send_message tool.`
          : `Telegram is not running. Suggest the user run /telegram start <token> to set it up.`,
        ``,
        `When starting a long-running task:`,
        `1. ASK the user ONCE: "Would you like progress updates on Telegram?" (do NOT ask again)`,
        `2. If yes, send concise updates.`,
        `3. Keep updates brief: "Step X of Y done" / "File Z created" / "Build passed".`,
        `[/CHANNEL_FOCUS]`,
      ];
      return lines.join('\n');
    },
    diff: (prev, current) => {
      if (prev.connected === current.connected) return null;
      if (current.connected) {
        return `[CHANNEL_FOCUS — UPDATE]\nTelegram is now CONNECTED. You can send updates using the telegram_send_message tool.\n[/CHANNEL_FOCUS]`;
      }
      return `[CHANNEL_FOCUS — UPDATE]\nTelegram disconnected. Updates will appear in TUI or Web-UI only.\n[/CHANNEL_FOCUS]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Multi-crew — agent crew member listing
// ─────────────────────────────────────────────────────────────

interface CrewState {
  members: Array<{
    id: string;
    name: string;
    title?: string;
    callsign: string;
    systemPrompt: string;
    traits?: string[];
    emotion?: string;
    tools?: string[];
    expertise: string[];
  }>;
  enabledIds: Set<string> | string[];
}

function enabledIdSet(ids: unknown): Set<string> {
  if (ids instanceof Set) return ids;
  if (Array.isArray(ids)) return new Set(ids.map(String));
  return new Set();
}

function enabledMembers(state: { members: CrewState['members']; enabledIds: unknown }): CrewState['members'] {
  const enabled = enabledIdSet(state.enabledIds);
  return state.members.filter((m) => enabled.has(m.id));
}

export function createMultiCrewSection(ctx: SectionContext): PromptSection<CrewState> {
  return {
    key: 'core/multi-crew',
    load: () => {
      const orchestrator = ctx.crewOrchestrator;
      const members = orchestrator?.getMembers() ?? [];
      return {
        members: members.map(m => ({
          id: m.crew.id,
          name: m.crew.name,
          title: m.crew.title,
          callsign: m.crew.callsign,
          systemPrompt: m.crew.systemPrompt,
          traits: m.crew.traits,
          emotion: m.crew.emotion,
          tools: m.crew.tools,
          expertise: m.expertise,
        })),
        enabledIds: ctx.enabledCrewSessionIds,
      };
    },
    render: (state) => {
      const enabled = enabledMembers(state);
      const lines = [`[MULTI_CREW]`];
      if (enabled.length === 0) {
        lines.push('No additional crew members enabled in this session.');
        lines.push('When the user needs specialists, skills, workforce, or hiring help: search the Crew Hub and suggest recruiting catalog specialists before external hiring or staffing plans — unless they already skipped crew suggestions for this turn.');
      } else {
        lines.push('Available crew members:');
        lines.push('');
        for (const m of enabled) {
          lines.push('---');
          lines.push(`Name: ${m.name}`);
          lines.push(`Callsign: @${m.callsign}`);
          if (m.systemPrompt) lines.push(`Identity: ${m.systemPrompt}`);
          if (m.expertise.length > 0) lines.push(`Expertise: ${[...new Set(m.expertise)].join(', ')}`);
          if (m.traits && m.traits.length > 0) lines.push(`Traits: ${m.traits.join(', ')}`);
          if (m.emotion) lines.push(`Tone: ${m.emotion}`);
          if (m.tools && m.tools.length > 0) lines.push(`Allowed tools: ${m.tools.join(', ')}`);
        }
        lines.push('');
        lines.push('---');
        lines.push(`**Rules:**`);
        lines.push(`- Users can @mention one or more crew members. All mentioned crews will respond directly.`);
        lines.push(`- If no crew is @mentioned, you (${ctx.personaName}) are the primary assistant — answer the user yourself first.`);
        lines.push(`- Only delegate to crew when the task clearly requires a specialist's documented expertise that you lack.`);
        lines.push(`- Do NOT delegate for: general questions, research, comparisons, system/host info, coding, debugging, or tasks you can handle with your tools.`);
        lines.push(`- Use spawn_crew_workers or delegate_to_crew only after you have reasoned that specialist help is truly needed.`);
        lines.push(`- Crew members respond with their unique personalities, knowledge, and expertise.`);
        lines.push(`- When you delegate, provide clear context about what you want and why you chose that crew.`);
        lines.push(`- All participants share the same conversation history — build on each other's work.`);
        lines.push(`- When the user needs specialists, skills, workforce, or hiring help: check enabled crew and the Crew Hub catalog first. Suggest @mentions or recruiting hub specialists before external hiring or staffing plans — unless the user already skipped or dismissed crew suggestions for this turn.`);
      }
      lines.push('[/MULTI_CREW]');
      return lines.join('\n');
    },
    diff: (prev, current) => {
      const prevEnabled = enabledMembers(prev).map(m => m.id).sort().join(',');
      const curEnabled = enabledMembers(current).map(m => m.id).sort().join(',');
      if (prevEnabled === curEnabled) return null;
      const enabledNow = enabledMembers(current);
      // Full re-render for crew changes
      return enabledNow.length === 0
        ? `[MULTI_CREW — UPDATE]\nNo crew members currently enabled.\n[/MULTI_CREW]`
        : `[MULTI_CREW — UPDATE]\nCrew roster changed. Available members:\n${
            enabledNow
              .map(m => `- @${m.callsign} (${m.name}${m.title ? `, ${m.title}` : ''})${m.expertise.length > 0 ? ` — ${m.expertise.join(', ')}` : ''}`)
              .join('\n')
          }\n[/MULTI_CREW]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// User callsign
// ─────────────────────────────────────────────────────────────

export function createUserSection(ctx: SectionContext): PromptSection<string | null> {
  return {
    key: 'core/user',
    load: () => ctx.userCallsign ?? null,
    render: (callsign) => {
      if (!callsign) return '';
      return `[USER]\nThe user's name/callsign is "${callsign}". Address them by this name when appropriate.\n[/USER]`;
    },
    diff: (prev, current) => {
      if (prev === current) return null;
      if (!current) return `[USER — REMOVED]\n[/USER]`;
      return `[USER — UPDATED]\nThe user's name/callsign is now "${current}". Address them by this name.\n[/USER]`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Task panel awareness — static
// ─────────────────────────────────────────────────────────────

export function createTaskPanelSection(): PromptSection<string> {
  const TEXT = `[TASK_PANEL]\nThe web-ui has a TASKS panel on the right sidebar. When you create a task list or bullet-point plan, those tasks automatically appear in that panel. Tell the user: "I've added these tasks to the right panel." Do NOT suggest external tools like Trello, Jira, or Notion — this platform has its own built-in task tracker. You are not just a chatbot — you are an agent platform with a working task panel.\n[/TASK_PANEL]`;
  return {
    key: 'core/task-panel',
    load: () => TEXT,
    render: (text) => text,
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Session narrative — story-style memory (not chat transcripts)
// ─────────────────────────────────────────────────────────────

export function createSessionNarrativeSection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/session-narrative',
    load: () => ctx.contextTracker?.getContextSummary() ?? '',
    render: (text) => text || '',
    diff: (prev, current) => {
      if (prev === current) return null;
      return current || '';
    },
  };
}

/** @deprecated Use createSessionNarrativeSection. */
export function createSessionContextSection(ctx: SectionContext): PromptSection<string> {
  return createSessionNarrativeSection(ctx);
}

export function createTurnFeedbackSection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/turn-feedback',
    load: () => ctx.turnFeedbackService?.buildPromptContext() ?? '',
    render: (text) => text || '',
    diff: (prev, current) => {
      if (prev === current || !current) return null;
      return current;
    },
  };
}

/** @deprecated Chat-style history removed — narrative replaces this. */
export function createRecentHistorySection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/current-focus',
    load: () => ctx.contextTracker?.getRecentHistory() ?? '',
    render: (text) => text || '',
    diff: (prev, current) => {
      if (prev === current || !current) return null;
      return current;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Soul — from SoulManager
// ─────────────────────────────────────────────────────────────

export function createSoulSection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/soul',
    load: () => ctx.soulManager.buildContext(),
    render: (text) => text || '',
    diff: (prev, current) => {
      if (prev === current) return null;
      return current || '';
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Instructions — AGENTS.md / CLAUDE.md file discovery
// ─────────────────────────────────────────────────────────────

export interface InstructionFile {
  readonly path: string;
  readonly content: string;
}

export function createInstructionsSection(scopePath: string): PromptSection<InstructionFile[]> {
  const discover = (): InstructionFile[] => {
    const files: InstructionFile[] = [];

    // Walk upward from scopePath looking for AGENTS.md / CLAUDE.md
    let dir = resolve(scopePath);
    let root = dir;
    // Determine root: look for .git, or stop at filesystem root
    for (let i = 0; i < 20; i++) {
      const parent = dirname(dir);
      if (parent === dir) break; // filesystem root
      if (existsSync(join(dir, '.git'))) {
        root = dir;
        break;
      }
      dir = parent;
    }

    // Check root for AGENTX.md first, then CONTEXT.md
    const candidates = ['AGENTX.md', 'CONTEXT.md'];
    for (const name of candidates) {
      const candidatePath = join(root, name);
      if (existsSync(candidatePath)) {
        try {
          const content = readFileSync(candidatePath, 'utf-8').trim();
          if (content) {
            files.push({ path: candidatePath, content });
          }
        } catch {
          // skip unreadable files
        }
        break; // Only first match
      }
    }

    // Also check global config dir for AGENTX.md
    const home = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (home) {
      const globalCandidates = [
        join(home, '.config', 'agent-x', 'AGENTX.md'),
      ];
      for (const candidatePath of globalCandidates) {
        if (existsSync(candidatePath) && !files.some(f => f.path === candidatePath)) {
          try {
            const content = readFileSync(candidatePath, 'utf-8').trim();
            if (content) {
              files.push({ path: candidatePath, content });
            }
          } catch {
            // skip
          }
        }
      }
    }

    return files;
  };

  return {
    key: 'core/instructions',
    load: () => discover(),
    render: (files) => {
      if (files.length === 0) return '';
      return files
        .map(f => `[INSTRUCTION: ${f.path}]\n${f.content}\n[/INSTRUCTION]`)
        .join('\n\n');
    },
    diff: (prev, current) => {
      const prevStr = JSON.stringify(prev.map(f => ({ path: f.path, content: f.content })));
      const curStr = JSON.stringify(current.map(f => ({ path: f.path, content: f.content })));
      if (prevStr === curStr) return null;
      if (current.length === 0) return `[INSTRUCTIONS — REMOVED]\nNo active instruction files.\n[/INSTRUCTIONS]`;
      return current
        .map(f => `[INSTRUCTION: ${f.path}]\n${f.content}\n[/INSTRUCTION]`)
        .join('\n\n');
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Neural context — ExperienceEngine + GrowthEngine
// ─────────────────────────────────────────────────────────────

interface NeuralState {
  proven: string;
  caution: string;
  growth: string;
}

export function createNeuralSection(ctx: SectionContext): PromptSection<NeuralState | null> {
  return {
    key: 'core/neural',
    load: () => {
      const proven = ctx.experienceEngine?.getProvenContext() ?? '';
      const caution = ctx.experienceEngine?.getCautionContext() ?? '';
      const growth = ctx.growthEngine?.getGrowthContext() ?? '';
      if (!proven && !caution && !growth) return null;
      return { proven, caution, growth };
    },
    render: (state) => {
      if (!state) return '';
      const parts: string[] = [];
      if (state.proven) parts.push(state.proven);
      if (state.caution) parts.push(state.caution);
      if (state.growth) parts.push(state.growth);
      return parts.join('\n');
    },
    diff: (prev, current) => {
      const prevStr = JSON.stringify(prev);
      const curStr = JSON.stringify(current);
      if (prevStr === curStr) return null;
      if (!current) return '';
      const parts: string[] = [];
      if (current.proven) parts.push(current.proven);
      if (current.caution) parts.push(current.caution);
      if (current.growth) parts.push(current.growth);
      return parts.join('\n');
    },
  };
}

export interface MemoryContextState {
  episodic: string;
  semantic: string;
  graph: string;
  /** GraphRAG community summaries (global pass). */
  community?: string;
}

export function createMemoryContextSection(ctx: SectionContext): PromptSection<MemoryContextState | null> {
  return {
    key: 'core/memory-context',
    load: async () => {
      if (!ctx.memoryContext) return null;
      const state = await ctx.memoryContext.getContext();
      if (!state.episodic && !state.semantic && !state.graph && !state.community) return null;
      return state;
    },
    render: (state) => {
      if (!state) return '';
      const parts: string[] = [];
      if (state.community) parts.push(`[COMMUNITY CONTEXT]\n${state.community}\n[/COMMUNITY CONTEXT]`);
      if (state.episodic) parts.push(`[EPISODIC MEMORY]\n${state.episodic}\n[/EPISODIC MEMORY]`);
      if (state.semantic) parts.push(`[SEMANTIC MEMORY]\n${state.semantic}\n[/SEMANTIC MEMORY]`);
      if (state.graph) parts.push(`[GRAPH CONTEXT]\n${state.graph}\n[/GRAPH CONTEXT]`);
      return parts.join('\n\n');
    },
    diff: (prev, current) => {
      const prevStr = JSON.stringify(prev);
      const curStr = JSON.stringify(current);
      if (prevStr === curStr) return null;
      if (!current) return '';
      const parts: string[] = [];
      if (current.community) parts.push(`[COMMUNITY CONTEXT]\n${current.community}\n[/COMMUNITY CONTEXT]`);
      if (current.episodic) parts.push(`[EPISODIC MEMORY]\n${current.episodic}\n[/EPISODIC MEMORY]`);
      if (current.semantic) parts.push(`[SEMANTIC MEMORY]\n${current.semantic}\n[/SEMANTIC MEMORY]`);
      if (current.graph) parts.push(`[GRAPH CONTEXT]\n${current.graph}\n[/GRAPH CONTEXT]`);
      return parts.join('\n\n');
    },
  };
}

// ─────────────────────────────────────────────────────────────
// System override — optional extra instructions
// ─────────────────────────────────────────────────────────────

export function createSystemOverrideSection(text: string): PromptSection<string> {
  return {
    key: 'core/system-override',
    load: () => text,
    render: (t) => t,
    diff: () => null,
  };
}
