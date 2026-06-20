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
    `RESPONSE FORMAT:`,
    `- Be concise unless the task requires depth. Adjust length to the task.`,
    `- Confirmation: "Done: [what]". Error: "Failed: [why] — [fix]".`,
    `- NEVER repeat what the user said. Never summarize your process. Just deliver.`,
    `- Be thorough and complete in your domain output.`,
    `- ONLY elaborate if user asks "explain more" / "go deeper".`,
    `[/RULES]`,
  ].join('\n');
  return {
    key: 'core/rules',
    load: () => RULES,
    render: (text) => text,
    diff: () => null, // Never changes
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
  return {
    key: 'core/current-time',
    load: () => ({
      iso: new Date().toISOString(),
      timezone: ctx.getUserTimezone(),
      local: new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: ctx.getUserTimezone() }),
      offset: ctx.getUtcOffset(),
    }),
    render: (t) =>
      `[CURRENT_TIME]\nNow: ${t.iso}\nUser timezone: ${t.timezone}\nLocal time (user): ${t.local}\nUTC offset: ${t.offset}\n[/CURRENT_TIME]`,
    diff: () => null, // Time is always correct at render time — no diff needed
  };
}

// ─────────────────────────────────────────────────────────────
// Scheduling — static reminder_set instructions
// ─────────────────────────────────────────────────────────────

export function createSchedulingSection(): PromptSection<string> {
  const SCHEDULING = [
    `[SCHEDULING]`,
    `For reminders and recurring tasks, use the reminder_set tool:`,
    `- "remind me in X" / "ping me in X" / "alert me after X" → one-time (delay_seconds)`,
    `- "remind me at <time>" / "at 5pm" / "at 3:30 PM" → one-time (at_time in ISO 8601)`,
    `- "remind me every X" / "check every X" / "repeat every X" → recurring (interval_minutes)`,
    `- For absolute times: use [CURRENT_TIME] to compute the ISO 8601 target. Include timezone offset.`,
    `- Convert relative: "half an hour" = 1800s, "2 hours" = 7200s, "every day" = 1440 min`,
    `- IMPORTANT: If user says a specific clock time, ALWAYS use at_time (not delay_seconds).`,
    `- Confirm in plain language after setting: "Done! I'll ping you at 5:04 PM."`,
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
  enabledIds: Set<string>;
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
      const enabled = state.members.filter(m => state.enabledIds.has(m.id));
      const lines = [`[MULTI_CREW]`];
      if (enabled.length === 0) {
        lines.push('No additional crew members enabled in this session.');
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
        lines.push(`- Users can @mention one or more crew members. All mentioned crews will respond.`);
        lines.push(`- If no crew is mentioned, you (${ctx.personaName}) respond as the primary assistant.`);
        lines.push(`- You can delegate sub-tasks to any crew member using the delegate_to_crew tool.`);
        lines.push(`- Crew members respond with their unique personalities, knowledge, and expertise.`);
        lines.push(`- When you delegate, provide clear context about what you want and why you chose that crew.`);
        lines.push(`- All participants share the same conversation history — build on each other's work.`);
      }
      lines.push('[/MULTI_CREW]');
      return lines.join('\n');
    },
    diff: (prev, current) => {
      const prevEnabled = prev.members.filter(m => prev.enabledIds.has(m.id)).map(m => m.id).sort().join(',');
      const curEnabled = current.members.filter(m => current.enabledIds.has(m.id)).map(m => m.id).sort().join(',');
      if (prevEnabled === curEnabled) return null;
      // Full re-render for crew changes
      return current.members.filter(m => current.enabledIds.has(m.id)).length === 0
        ? `[MULTI_CREW — UPDATE]\nNo crew members currently enabled.\n[/MULTI_CREW]`
        : `[MULTI_CREW — UPDATE]\nCrew roster changed. Available members:\n${
            current.members.filter(m => current.enabledIds.has(m.id))
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
// Session context — from ContextTracker
// ─────────────────────────────────────────────────────────────

export function createSessionContextSection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/session-context',
    load: () => ctx.contextTracker?.getContextSummary() ?? '',
    render: (text) => text || '',
    diff: (prev, current) => {
      // Always re-render session context — it's a full snapshot
      if (prev === current) return null;
      return current ? `[SESSION_CONTEXT]\n${current}\n[/SESSION_CONTEXT]` : '';
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Recent history — from ContextTracker
// ─────────────────────────────────────────────────────────────

export function createRecentHistorySection(ctx: SectionContext): PromptSection<string> {
  return {
    key: 'core/recent-history',
    load: () => ctx.contextTracker?.getRecentHistory() ?? '',
    render: (text) => text || '',
    diff: (prev, current) => {
      if (prev === current) return null;
      return current ? `[RECENT_HISTORY]\n${current}\n[/RECENT_HISTORY]` : '';
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
