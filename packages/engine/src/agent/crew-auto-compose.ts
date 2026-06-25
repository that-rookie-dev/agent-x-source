import { CREW_DOMAIN_KEYWORDS } from '@agentx/shared';
import type { CrewMember } from './CrewOrchestrator.js';

export interface CrewNeedAssessment {
  members: CrewMember[];
  confidence: number;
  reasons: string[];
  shouldRoute: boolean;
}

const DOMAIN_HINTS: Array<{ pattern: RegExp; keywords: string[] }> = [
  { pattern: /\b(meal|diet|nutrition|food|recipe|calorie|macro|eating|wellness|health|vitamin|protein)\b/i, keywords: ['nutrition', 'health', 'wellness', 'diet', 'food', 'meal'] },
  { pattern: /\b(tax|irs|income|deduction|financial|finance|invest|budget|accounting|bookkeep)\b/i, keywords: ['tax', 'finance', 'financial', 'accounting', 'wealth', 'budget'] },
  { pattern: /\b(api|backend|server|database|microservice|endpoint|graphql|rest)\b/i, keywords: ['backend', 'api', 'database', 'distributed', 'microservices', 'node'] },
  { pattern: /\b(frontend|react|css|ui|ux|design|dashboard|component|tailwind)\b/i, keywords: ['frontend', 'react', 'design', 'ui', 'ux', 'css'] },
  { pattern: /\b(deploy|docker|kubernetes|ci\/cd|devops|infra|pipeline|helm)\b/i, keywords: ['devops', 'docker', 'kubernetes', 'ci/cd', 'infrastructure', 'cloud'] },
  { pattern: /\b(security|audit|vulnerability|owasp|penetration|encrypt|auth)\b/i, keywords: ['security', 'audit', 'owasp', 'threat'] },
  { pattern: /\b(legal|contract|compliance|regulation|law|gdpr|privacy)\b/i, keywords: ['legal', 'compliance', 'law', 'regulation', 'contract'] },
  { pattern: /\b(marketing|seo|content|copywrit|brand|campaign|social media)\b/i, keywords: ['marketing', 'seo', 'content', 'brand'] },
  { pattern: /\b(data|analytics|machine learning|ml\b|model train|dataset|pandas)\b/i, keywords: ['data', 'analytics', 'ml', 'ai'] },
  { pattern: /\b(mobile|ios|android|swift|kotlin|flutter|react native)\b/i, keywords: ['mobile', 'ios', 'android'] },
  { pattern: /\b(test|qa|quality|regression|e2e|unit test)\b/i, keywords: ['testing', 'qa', 'test', 'quality'] },
  { pattern: /\b(write|essay|blog|document|documentation|readme)\b/i, keywords: ['documentation', 'writing', 'content'] },
  { pattern: /\b(trip|travel|vacation|itinerary|beach|hotel|flight|tourism|holiday)\b/i, keywords: ['travel', 'tourism', 'hospitality', 'planning', 'logistics'] },
];

const TASK_ACTION_SIGNALS = /\b(create|build|fix|debug|implement|design|write|draft|analyze|review|audit|plan|prepare|optimize|deploy|configure|set up|setup|calculate|estimate|research|investigate|troubleshoot|refactor|migrate|test|automate|improve|recommend|suggest|help me|need help|can you|could you|please|figure out|work on|look into|set up)\b/i;

/** Pronoun follow-ups — exclude deictic "this/that" when referring to the host/session. */
const CONTINUATION_SIGNALS = /\b(yes|yeah|yep|sure|ok|okay|please|go ahead|do it|continue|proceed|it|also|instead|more|less|again|same|vegetarian|vegan|gluten)\b/i;
const CONTINUATION_DEICTIC = /\b(that|this)\b(?!\s+(system|machine|session|host|computer|device|pc|mac|linux))\b/i;

/** Queries Agent-X should handle directly — not specialist crew work. */
const AGENT_X_DIRECT_QUERIES = /\b(agent[- ]?x|this system|system spec|machine spec|hardware spec|pull the spec|system info|host info|my (machine|computer|system|device)|cpu|ram|gpu|disk space|os version|operating system)\b/i;
const ADDRESS_AGENT_X = /\b(message|talk to|ask|tell)\s+agent[- ]?x\b/i;

const SOCIAL_ONLY = /^(hi|hey|hello|thanks|thank you|bye|goodbye|ok|okay|sure|got it|cool|great|nice)\b/i;

/** User defers decisions to the agent/crew — deliver a plan with stated assumptions. */
const USER_DEFERS_TO_AGENT = /\b(plan it yourself|you decide|you suggest|figure it out|just plan|surprise me|choose for me|pick for me|on your own|your call|up to you|not sure|do it yourself|plan on your own)\b/i;

export function userDeferredToAgent(text: string): boolean {
  return USER_DEFERS_TO_AGENT.test(text.trim());
}

/** Skip autonomous crew routing for host/session/meta questions directed at Agent-X. */
export function shouldSkipAutonomousCrewRouting(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return AGENT_X_DIRECT_QUERIES.test(trimmed) || ADDRESS_AGENT_X.test(trimmed);
}

function memberExpertise(member: CrewMember): string[] {
  const fromCrew = member.crew.expertise ?? [];
  const fromMember = member.expertise ?? [];
  const traits = member.crew.traits ?? [];
  return [...new Set([...fromMember, ...fromCrew, ...traits])];
}

function memberProfileBlob(member: CrewMember): string {
  return [
    member.crew.systemPrompt,
    member.crew.description ?? '',
    member.crew.title ?? '',
    member.crew.name,
    ...memberExpertise(member),
  ].join(' ').toLowerCase();
}

function scoreMember(taskLower: string, member: CrewMember): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const blob = memberProfileBlob(member);

  for (const exp of memberExpertise(member)) {
    const e = exp.toLowerCase();
    if (e.length < 3) continue;
    if (taskLower.includes(e)) {
      score += 5;
      reasons.push(`expertise:${exp}`);
    }
    for (const word of e.split(/[\s,/]+/)) {
      if (word.length > 3 && taskLower.includes(word)) {
        score += 2;
      }
    }
  }

  for (const hint of DOMAIN_HINTS) {
    if (hint.pattern.test(taskLower)) {
      for (const kw of hint.keywords) {
        if (blob.includes(kw)) {
          score += 4;
          reasons.push(`domain:${kw}`);
        }
      }
    }
  }

  for (const kw of CREW_DOMAIN_KEYWORDS) {
    if (taskLower.includes(kw) && blob.includes(kw)) {
      score += 2;
      reasons.push(`keyword:${kw}`);
    }
  }

  for (const word of taskLower.split(/\s+/)) {
    if (word.length > 4 && blob.includes(word)) score += 0.5;
  }

  if (TASK_ACTION_SIGNALS.test(taskLower) && reasons.length > 0) {
    score += 2;
    reasons.push('task-action');
  }

  if (member.active !== false) score += 0.5;
  return { score, reasons: [...new Set(reasons)] };
}

/** Merge prior user turns when the latest message is a short follow-up. */
export function buildTaskContextForCrewRouting(
  currentMessage: string,
  priorUserMessages: string[] = [],
): string {
  const current = currentMessage.trim();
  if (priorUserMessages.length === 0) return current;

  if (shouldSkipAutonomousCrewRouting(current)) return current;

  const substantive = priorUserMessages
    .map((m) => m.trim())
    .filter((m) => m.length > 10)
    .slice(-2);

  if (substantive.length === 0) return current;

  const hasContinuationCue = CONTINUATION_SIGNALS.test(current) || CONTINUATION_DEICTIC.test(current);
  const shortFollowUp = current.split(/\s+/).length <= 12
    && (hasContinuationCue || !TASK_ACTION_SIGNALS.test(current));
  const defersToAgent = userDeferredToAgent(current);
  const lacksStandaloneDomain = !DOMAIN_HINTS.some((h) => h.pattern.test(current));

  if (defersToAgent || shortFollowUp || (lacksStandaloneDomain && substantive.length > 0)) {
    return `${substantive.join(' ')} ${current}`.trim();
  }

  return current;
}

export function isContinuationMessage(text: string): boolean {
  const trimmed = text.trim();
  if (shouldSkipAutonomousCrewRouting(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 10
    && (CONTINUATION_SIGNALS.test(trimmed) || CONTINUATION_DEICTIC.test(trimmed));
}

const CREW_SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'can', 'you', 'help', 'me', 'please', 'could', 'would',
  'this', 'that', 'are', 'was', 'were', 'have', 'has', 'had', 'am', 'is', 'my', 'our',
  'your', 'his', 'her', 'their', 'who', 'what', 'when', 'where', 'how', 'why', 'also',
  'just', 'need', 'want', 'like', 'some', 'any', 'all', 'very', 'really',
  'skilled', 'person', 'people', 'hire', 'hiring', 'workforce', 'specialist', 'expert',
  'someone', 'talent', 'resource', 'resources', 'qualified', 'experienced', 'looking',
]);

/** Build a focused catalog FTS query — avoids OR-matching every crew on filler tokens. */
export function buildCrewSuggestionSearchQuery(task: string): string {
  const trimmed = task.trim();
  if (!trimmed) return trimmed;

  const domainKeys = extractDomainKeywords(trimmed);
  const tokens = trimmed
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !CREW_SEARCH_STOP_WORDS.has(w));

  const parts: string[] = [];
  for (const d of domainKeys) parts.push(d);
  for (const t of tokens) {
    if (!parts.includes(t)) parts.push(t);
  }

  const query = parts.slice(0, 8).join(' ');
  return query.length >= 3 ? query : trimmed.slice(0, 120);
}

export function extractDomainKeywords(text: string): Set<string> {
  const keys = new Set<string>();
  const lower = text.toLowerCase();
  for (const hint of DOMAIN_HINTS) {
    if (hint.pattern.test(lower)) {
      for (const kw of hint.keywords) keys.add(kw);
    }
  }
  return keys;
}

/** True when the message introduces a domain not covered by recent user turns. */
export function isDistinctNewRequirement(
  message: string,
  priorUserMessages: string[] = [],
): boolean {
  const current = message.trim();
  if (!current || priorUserMessages.length === 0) return false;

  const currentDomains = extractDomainKeywords(current);
  if (currentDomains.size === 0) return false;

  const priorText = priorUserMessages.slice(-3).join(' ');
  const priorDomains = extractDomainKeywords(priorText);
  if (priorDomains.size === 0) return true;

  let overlap = 0;
  for (const d of currentDomains) {
    if (priorDomains.has(d)) overlap++;
  }
  return overlap === 0 || currentDomains.size >= priorDomains.size + 2;
}

/** True when the user is continuing the current task — not opening a new requirement. */
export function isActiveCrewContinuation(
  message: string,
  priorUserMessages: string[] = [],
): boolean {
  const current = message.trim();
  if (priorUserMessages.length === 0) return false;
  if (userDeferredToAgent(current) || isContinuationMessage(current)) return true;

  const merged = buildTaskContextForCrewRouting(current, priorUserMessages);
  if (merged !== current && merged.includes(current)) return true;

  if (current.split(/\s+/).length <= 8 && extractDomainKeywords(current).size === 0) return true;

  return false;
}

/** True when the text looks like work a specialist should handle (not pure social chat). */
export function hasTaskSignals(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || SOCIAL_ONLY.test(trimmed)) return false;
  if (TASK_ACTION_SIGNALS.test(trimmed)) return true;
  if (DOMAIN_HINTS.some((h) => h.pattern.test(trimmed))) return true;
  return CREW_DOMAIN_KEYWORDS.some((kw) => trimmed.toLowerCase().includes(kw));
}

/** Score all crew members and decide whether Agent-X should autonomously involve them. */
export function assessCrewNeed(task: string, availableMembers: CrewMember[]): CrewNeedAssessment {
  const empty: CrewNeedAssessment = { members: [], confidence: 0, reasons: [], shouldRoute: false };
  if (availableMembers.length === 0 || !hasTaskSignals(task)) return empty;

  const taskLower = task.toLowerCase();
  const scored = availableMembers
    .map((member) => {
      const { score, reasons } = scoreMember(taskLower, member);
      return { member, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score <= 0) return empty;

  const margin = second ? best.score - second.score : best.score;
  const minScore = margin >= 4 ? 2 : margin >= 2 ? 2.5 : 3;

  if (best.score < minScore) return empty;

  const threshold = Math.max(minScore, best.score * 0.7);
  const selected: CrewMember[] = [];
  const allReasons = new Set<string>(best.reasons);
  const seen = new Set<string>();

  for (const { member, score, reasons } of scored) {
    if (score < threshold || selected.length >= 3) break;
    if (seen.has(member.crew.id)) continue;
    seen.add(member.crew.id);
    selected.push(member);
    for (const r of reasons) allReasons.add(r);
  }

  const confidence = Math.min(1, (best.score / 14) * (1 + margin / Math.max(best.score, 1)));
  const shouldRoute = confidence >= 0.35 || (best.score >= 3 && margin >= 1.5);

  return {
    members: shouldRoute ? selected : [],
    confidence: shouldRoute ? confidence : 0,
    reasons: shouldRoute
      ? [`Matched @${best.member.crew.callsign}`, ...Array.from(allReasons).slice(0, 4)]
      : [],
    shouldRoute: shouldRoute && selected.length > 0,
  };
}

/** Pick crew members whose expertise matches the user task (1–3 operatives). */
export function autoComposeCrewMembers(task: string, availableMembers: CrewMember[]): CrewMember[] {
  return assessCrewNeed(task, availableMembers).members;
}
