import type { QuestionnairePayload } from '@agentx/shared';
import { generateId } from '@agentx/shared';

const MONTH_RE = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
const DEFER_RE = /\b(you decide|surprise me|up to you|don't care|dont care|whatever works|plan it yourself|use your judgment|use your judgement)\b/i;
const PLANNING_RE = /\b(plan|itinerary|roadmap|strategy|outline|proposal|organize|schedule|vacation|trip|travel|holiday|wedding|event|project)\b/i;

function countSpecificitySignals(text: string): number {
  let signals = 0;
  if (/\b(in|to|visit|going to|from)\s+[A-Z][\w-]+/.test(text)) signals += 1;
  if (MONTH_RE.test(text) || /\b\d+\s*(day|days|week|weeks|night|nights)\b/i.test(text)) signals += 1;
  if (/\$\d|budget|usd|eur|rupee|₹|\b(luxury|budget|mid-?range)\b/i.test(text)) signals += 1;
  if (/\b(family|couple|solo|group|kids|team of|with my)\b/i.test(text)) signals += 1;
  if (/\b(must|require|prefer|avoid|constraint|priority|priorities)\b/i.test(text)) signals += 1;
  return signals;
}

/** True when a deployed specialist should run structured intake before producing a plan. */
export function needsCrewDeploymentIntake(userText: string): boolean {
  const trimmed = userText.trim();
  if (!trimmed || trimmed.length < 12) return false;
  if (DEFER_RE.test(trimmed)) return false;
  if (!PLANNING_RE.test(trimmed)) return false;
  return countSpecificitySignals(trimmed) < 2;
}

export function buildCrewDeploymentIntakeQuestionnaire(
  userText: string,
  specialistLabel?: string,
): QuestionnairePayload {
  const isTravel = /\b(vacation|trip|travel|itinerary|holiday)\b/i.test(userText);
  const title = specialistLabel
    ? `${specialistLabel} — a few details first`
    : 'Planning details';

  if (isTravel) {
    return {
      id: generateId('q'),
      title,
      source: { kind: 'agent', name: 'Agent-X' },
      allowSkip: true,
      questions: [
        {
          id: 'destination',
          prompt: 'Where would you like to go (or what type of destination)?',
          type: 'text',
          required: false,
          placeholder: 'e.g. coastal Europe, Japan, mountains in India…',
        },
        {
          id: 'travelers',
          prompt: 'Who is traveling?',
          type: 'single_choice',
          required: false,
          options: ['Solo', 'Couple', 'Family with kids', 'Group of friends', 'Other'],
        },
        {
          id: 'budget',
          prompt: 'What budget range are you aiming for?',
          type: 'single_choice',
          required: false,
          options: ['Budget', 'Mid-range', 'Luxury', 'Flexible / not sure'],
        },
        {
          id: 'priorities',
          prompt: 'What matters most for this trip?',
          type: 'text',
          required: false,
          placeholder: 'e.g. relaxation, adventure, food, culture…',
        },
      ],
    };
  }

  return {
    id: generateId('q'),
    title,
    source: { kind: 'agent', name: 'Agent-X' },
    allowSkip: true,
    questions: [
      {
        id: 'goal',
        prompt: 'What is the main goal or outcome you want?',
        type: 'text',
        required: false,
        placeholder: 'Be as specific as you can…',
      },
      {
        id: 'timeline',
        prompt: 'What timeline or deadline applies?',
        type: 'text',
        required: false,
        placeholder: 'e.g. by end of December, 2 weeks, no rush…',
      },
      {
        id: 'constraints',
        prompt: 'Any constraints, preferences, or must-haves?',
        type: 'text',
        required: false,
        placeholder: 'Budget, audience, tools, location, etc.',
      },
    ],
  };
}
