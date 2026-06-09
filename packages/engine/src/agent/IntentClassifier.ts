import type { ProviderInterface } from '../providers/ProviderInterface.js';

export type IntentCategory =
  | 'greeting'
  | 'farewell'
  | 'conversational'
  | 'question'
  | 'simple_task'
  | 'complex_task'
  | 'meta_command'
  | 'continuation';

export interface IntentContext {
  message: string;
  recentMessages: Array<{ role: string; content: string }>;
}

export interface IntentResult {
  intent: IntentCategory;
  confidence: number;
  reasoning: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
}

const INTENTS_LIST: IntentCategory[] = [
  'greeting',
  'farewell',
  'conversational',
  'question',
  'simple_task',
  'complex_task',
  'meta_command',
  'continuation',
];

const INTENT_EXAMPLES: Record<IntentCategory, string> = {
  greeting: '"hi", "hey", "hello", "good morning", "whats up", "howdy", what\'s up"',
  farewell: '"bye", "thanks", "see you", "goodnight", "cheers", "take care"',
  conversational: '"ok", "sure", "got it", "nice", "cool", "interesting", "i see", "makes sense"',
  question: '"what is X?", "how does Y work?", "why did this happen?", "can you explain?", "where is the file?"',
  simple_task: '"create a file", "run this command", "fix this bug", "write a test"',
  complex_task: '"build a full project", "refactor the codebase", "design an architecture", "set up CI/CD pipeline"',
  meta_command: '"use GPT-4", "switch model", "enable plan mode", "show models", "list sessions"',
  continuation: '"also do the same for X", "and then add Y", "now do that too", "continue", "what about the other one"',
};

const LOADING_PHRASES = [
  'Receiving transmission...',
  'Decoding signal...',
  'Calibrating sensors...',
  'Powering up core systems...',
  'Initializing neural pathways...',
  'Booting auxiliary modules...',
  'Establishing uplink...',
  'Scanning knowledge banks...',
  'Consulting the archives...',
  'Warming up logic circuits...',
  'Tuning hyperparameters...',
  'Running pre-flight checks...',
  'Priming response engines...',
  'Syncing memory banks...',
  'Loading context vectors...',
  'Charging capacitors...',
  'Engaging reasoning matrix...',
  'Brewing intelligence...',
  'Compiling response...',
  'Routing through neural net...',
  'Aligning with mission parameters...',
  'Calibrating precision thrusters...',
  'Activating auxiliary power...',
  'Polling data streams...',
  'Resolving dependencies...',
];

function randomLoadingLabel(): string {
  return LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)]!;
}

export function getLoadingSteps(_intent: IntentCategory) {
  return [{ id: 'load', label: randomLoadingLabel(), status: 'active' as const }];
}

export class IntentClassifier {
  private provider: ProviderInterface;
  private model: string;

  constructor(provider: ProviderInterface, model: string) {
    this.provider = provider;
    this.model = model;
  }

  async classify(context: IntentContext): Promise<IntentResult> {
    const prompt = this.buildPrompt(context);

    let responseText = '';
    for await (const chunk of this.provider.complete({
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
      model: this.model,
      stream: false,
      temperature: 0.1,
      maxTokens: 300,
    })) {
      if (chunk.type === 'text_delta') {
        responseText += chunk.content;
      }
    }

    return this.parseResponse('{' + responseText, context.message);
  }

  private buildPrompt(context: IntentContext): string {
    const { message, recentMessages } = context;

    let contextBlock = '';
    if (recentMessages.length > 0) {
      contextBlock = [
        '--- Recent conversation (oldest first) ---',
        ...recentMessages.map((m) => `[${m.role}]: ${m.content}`),
        '--- End of conversation ---',
      ].join('\n');
    }

    return [
      'You are a message classifier for an AI coding agent. Classify the user\'s LATEST message into exactly one category.',
      '',
      'Categories:',
      ...INTENTS_LIST.map((intent) => `- ${intent}: ${INTENT_EXAMPLES[intent]}`),
      '',
      'Rules:',
      '- "greeting" is for casual hellos, salutations, or "what\'s up" type openers',
      '- "farewell" is for thanks, goodbyes, sign-offs',
      '- "conversational" is for acknowledgments, short reactions, casual follow-ups with no actionable request',
      '- "question" is for asking about information, concepts, or how something works',
      '- "simple_task" is for a single concrete action or request',
      '- "complex_task" is for multi-step, multi-file, or multi-tool requests',
      '- "meta_command" is for commanding the agent itself (switch model, show status, etc.)',
      '- "continuation" is when the user refers to the previous response and asks for more, similar, or follow-through',
      '',
      'If the message is too vague, ambiguous, or you cannot confidently determine the intent (confidence < 0.6),',
      'set "needsClarification" to true and provide a clarification question with 2-4 concise options.',
      'The options should help the user clarify what they want. Use "allowFreeform" to let them type freely.',
      '',
      'Recent conversation provides context for understanding whether this message continues a prior topic.',
      '',
      contextBlock ? contextBlock + '\n' : '',
      `User message: "${message}"`,
      '',
      'Respond with valid JSON only, no markdown, no explanation:',
      '{',
      '  "intent": "<category>",',
      '  "confidence": <0.0-1.0>,',
      '  "reasoning": "<brief 1-sentence explanation>",',
      '  "needsClarification": <true|false>,',
      '  "clarificationQuestion": "<question if needsClarification>",',
      '  "clarificationOptions": ["option1", "option2", ...]',
      '}',
    ].join('\n');
  }

  private parseResponse(raw: string, originalMessage: string): IntentResult {
    try {
      const parsed = JSON.parse(raw);

      const intent = INTENTS_LIST.includes(parsed.intent)
        ? (parsed.intent as IntentCategory)
        : this.fallback(originalMessage);

      const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : 0.5;

      const reasoning = typeof parsed.reasoning === 'string'
        ? parsed.reasoning.slice(0, 200)
        : 'LLM classification';

      const needsClarification = parsed.needsClarification === true && confidence < 0.6;

      const clarificationQuestion = needsClarification && typeof parsed.clarificationQuestion === 'string'
        ? parsed.clarificationQuestion
        : undefined;

      const clarificationOptions = needsClarification && Array.isArray(parsed.clarificationOptions)
        ? parsed.clarificationOptions.filter((o: unknown) => typeof o === 'string').slice(0, 4)
        : undefined;

      return { intent, confidence, reasoning, needsClarification, clarificationQuestion, clarificationOptions };
    } catch {
      return this.fallbackWithReason(originalMessage, 'Failed to parse LLM response as JSON');
    }
  }

  private fallback(message: string): IntentCategory {
    const lower = message.toLowerCase().trim();

    if (/^(hi|hey|hello|howdy|hola|yo|sup|what('?)s up|wassup|morning|afternoon|evening|good\s+(morning|afternoon|evening|night)|greetings|namaste)\b/.test(lower)) return 'greeting';
    if (/^(bye|goodbye|see ya|later|thanks|thank you|thx|cheers|take care|good night|gn|ttyl|cya)\b/.test(lower)) return 'farewell';
    if (/^(ok|okay|sure|got it|i see|nice|cool|great|awesome|understood|makes sense|hmm|alright|yep|yeah|yes|no|nope|nah|right|correct|exactly|indeed|true|fair|interesting)\b/.test(lower)) return 'conversational';
    if (lower.endsWith('?') || /^(what|how|why|when|where|who|which|can|could|would|is|are|do|does|will|should)\b/.test(lower)) return 'question';

    return 'simple_task';
  }

  private fallbackWithReason(message: string, reason: string): IntentResult {
    return {
      intent: this.fallback(message),
      confidence: 0.4,
      reasoning: reason + ' — used heuristic fallback',
    };
  }
}
