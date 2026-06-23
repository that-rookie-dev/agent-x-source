import type { CrewMember } from './CrewOrchestrator.js';

export interface CrewDelegationGuardResult {
  allowed: boolean;
  reason: string;
}

export interface CrewDelegationGuardInput {
  userMessage: string;
  task: string;
  members: CrewMember[];
}

function formatCrewRoster(members: CrewMember[]): string {
  return members.map((m) => {
    const exp = [...new Set([...(m.expertise ?? []), ...(m.crew.expertise ?? [])])].join(', ') || 'general';
    const identity = m.crew.systemPrompt?.slice(0, 220) ?? m.crew.description ?? '';
    return `- @${m.crew.callsign} (${m.crew.name}): expertise=${exp}${identity ? `; ${identity}` : ''}`;
  }).join('\n');
}

/**
 * Conservative LLM gate — default deny unless the crew's domain clearly fits.
 * Used when Agent-X invokes crew tools, not for user @mentions.
 */
export async function evaluateCrewDelegation(
  input: CrewDelegationGuardInput,
  complete: (prompt: string) => Promise<string>,
): Promise<CrewDelegationGuardResult> {
  if (input.members.length === 0) {
    return { allowed: false, reason: 'No crew members selected' };
  }

  const prompt = `You are a conservative delegation gate for Agent-X, the user's primary assistant.

Agent-X wants to delegate work to crew specialist(s). Your default answer is DENY.

DENY when ANY of these apply:
- The user asked a general question, research question, opinion, comparison, or system/host/session info
- Agent-X can answer with tools or general knowledge (coding, debugging, specs, file ops, etc.)
- The proposed crew's expertise does not clearly and specifically match the task
- Delegating would surprise the user (wrong specialty, tangential domain match)
- The only available crew does not fit but Agent-X is delegating anyway

ALLOW only when ALL of these apply:
- The task clearly requires the named crew's documented specialty
- A reasonable user would expect that specialist to own this work
- Agent-X lacks deep domain expertise for this specific task

User's latest message:
"""${input.userMessage.slice(0, 600)}"""

Proposed crew task:
"""${input.task.slice(0, 600)}"""

Candidate crew:
${formatCrewRoster(input.members)}

Reply with exactly two lines:
Line 1: allow OR deny (lowercase)
Line 2: one-sentence reason`;

  try {
    const content = await complete(prompt);
    const lines = content.trim().split('\n').map((l) => l.trim());
    const decision = (lines[0] ?? 'deny').toLowerCase();
    const allowed = decision === 'allow' || decision.startsWith('allow ');
    const reason = lines.slice(1).join(' ').trim()
      || (allowed ? 'Specialist domain clearly matches' : 'Agent-X should handle this directly');
    return { allowed, reason };
  } catch {
    return { allowed: false, reason: 'Delegation guard unavailable — Agent-X should handle the task' };
  }
}
