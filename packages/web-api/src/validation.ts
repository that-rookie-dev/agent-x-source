import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware factory: validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (and typed) result.
 * On failure, returns a 422 with structured error details.
 */
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ─── Chat schemas ─────────────────────────────────────────────

const MAX_CHAT_TEXT_LEN = 100_000;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_CONTENT_LEN = 512_000;

export const clientSituationSchema = z.object({
  clientNow: z.string().min(1).max(64),
  timezone: z.string().min(1).max(128),
  locationLabel: z.string().max(256).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().min(0).max(1_000_000).optional(),
  source: z.enum(['browser', 'desktop', 'server']),
  locationMethod: z.enum(['gps', 'ip', 'timezone_only']).optional(),
  locationConfidence: z.enum(['high', 'low', 'unknown']).optional(),
  vpnSuspected: z.boolean().optional(),
}).optional();

export const chatMessageSchema = z.object({
  text: z.string().min(1, 'text is required').max(MAX_CHAT_TEXT_LEN),
  attachments: z.array(z.object({
    name: z.string().max(256),
    content: z.string().max(MAX_ATTACHMENT_CONTENT_LEN),
  })).max(MAX_ATTACHMENTS).optional(),
  retry: z.boolean().optional(),
  delegateCrewIds: z.array(z.string()).optional(),
  /** Set after user skips/deploys from CrewSuggestionModal — prevents server re-prompt. */
  crewSuggestionResolved: z.boolean().optional(),
  /** After in-chat crew roster picker — lead crew asks intake question first. */
  crewIntakeFromPicker: z.boolean().optional(),
  /** User turn already persisted (e.g. crew roster picker) — skip message_sent persistence. */
  userMessagePersisted: z.boolean().optional(),
  primaryCrewId: z.string().optional(),
  priorUserMessages: z.array(z.string()).optional(),
  /** Globe toggle in chat — force web search on this turn. */
  forceWebSearch: z.boolean().optional(),
  resumeCrewIntake: z.object({
    originalUserText: z.string(),
    intakeAnswer: z.string(),
    delegateCrewIds: z.array(z.string()),
    primaryCrewId: z.string().optional(),
  }).optional(),
  clientSituation: clientSituationSchema,
});

export const crewSuggestionEvaluateSchema = z.object({
  text: z.string().min(1),
  sessionId: z.string().min(1),
  priorUserMessages: z.array(z.string()).optional(),
});

export const crewSuggestionResolveSchema = z.object({
  sessionId: z.string().min(1),
  action: z.enum(['deploy', 'skip', 'dismiss']),
  dismissForSession: z.boolean().optional(),
  selectedCandidateIds: z.array(z.string()).optional(),
  candidates: z.array(z.object({
    id: z.string(),
    origin: z.enum(['hub_catalog', 'custom', 'hub_roster']),
    callsign: z.string(),
    name: z.string(),
    title: z.string(),
    description: z.string(),
    expertise: z.array(z.string()),
    traits: z.array(z.string()),
    matchScore: z.number(),
    reasons: z.array(z.string()),
    onRoster: z.boolean(),
    enabled: z.boolean().optional(),
    catalogId: z.string().optional(),
    categoryId: z.string().optional(),
    categoryLabel: z.string().optional(),
    tone: z.string().optional(),
    requiresMedicalDisclaimer: z.boolean().optional(),
  })).optional(),
});

export const crewChatSessionSchema = z.object({
  crewId: z.string().optional(),
  scopePath: z.string().optional(),
  recruit: z.object({
    id: z.string().optional(),
    name: z.string(),
    title: z.string().optional(),
    callsign: z.string().optional(),
    systemPrompt: z.string(),
    description: z.string().optional(),
    tone: z.string().optional(),
    expertise: z.array(z.string()).optional(),
    traits: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    source: z.string().optional(),
    catalogId: z.string().optional(),
    categoryId: z.string().optional(),
    color: z.string().optional(),
  }).optional(),
}).refine((d) => d.crewId || d.recruit, { message: 'crewId or recruit required' });

export const chatSteerSchema = z.object({
  text: z.string().min(1, 'text is required'),
  attachments: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })).optional(),
  delegateCrewIds: z.array(z.string()).optional(),
  crewSuggestionResolved: z.boolean().optional(),
  crewIntakeFromPicker: z.boolean().optional(),
  primaryCrewId: z.string().optional(),
  clientSituation: clientSituationSchema,
});

export const clarificationRespondSchema = z.object({
  response: z.string().min(1, 'response is required'),
  sessionId: z.string().min(1).optional(),
});

export const crewRosterPickerOfferSchema = z.object({
  userText: z.string().min(1),
  evaluation: z.object({
    shouldSuggest: z.boolean(),
    dismissed: z.boolean(),
    confidence: z.number(),
    taskSummary: z.string(),
    candidates: z.array(z.any()),
    reasons: z.array(z.string()),
  }),
  attachments: z.array(z.object({ name: z.string() })).optional(),
  userMessageId: z.string().min(1).optional(),
});

export const crewRosterPickerUpdateSchema = z.object({
  pickerMessageId: z.string().min(1),
  status: z.enum(['answered', 'skipped']),
  selectedCandidateIds: z.array(z.string()).optional(),
  evaluation: crewRosterPickerOfferSchema.shape.evaluation,
  pendingUserText: z.string().min(1),
  pickerPartId: z.string().optional(),
});

export const sessionMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().min(1).optional(),
});

export const permissionRespondSchema = z.object({
  requestId: z.string().min(1),
  choice: z.enum(['allow_once', 'allow_always', 'deny']),
});

export const permissionRespondBatchSchema = z.object({
  choice: z.enum(['allow_once', 'allow_always', 'deny']),
});

export const createSessionSchema = z.object({
  scopePath: z.string().optional(),
  parentId: z.string().optional(),
  mode: z.enum(['agent', 'plan']).optional(),
});

export const createCheckpointSchema = z.object({
  label: z.string().min(1, 'label is required'),
});

export const generateTitleSchema = z.object({
  message: z.string().min(1),
});

export const turnFeedbackSchema = z.object({
  messageId: z.string().min(1),
  rating: z.enum(['positive', 'negative', 'skipped']),
  turnSummary: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateSessionSchema = z.object({
  title: z.string().optional(),
  mode: z.enum(['agent', 'plan']).optional(),
});

export const providerValidateSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const updatePersonaSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  communicationStyle: z.enum(['formal', 'casual', 'direct', 'empathetic']).optional(),
  decisionMaking: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  domainContext: z.string().optional(),
  traits: z.array(z.string()).optional(),
});

export const authSetupSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const authLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const connectIntegrationSchema = z.object({
  authMode: z.enum(['oauth', 'sign_in_browser', 'api_key_form', 'none', 'stdio', 'env', 'remote_url', 'import_config']).optional(),
  env: z.record(z.string()).optional(),
  displayName: z.string().optional(),
  stdio: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  }).optional(),
  remote: z.object({
    url: z.string().url(),
  }).optional(),
});

export const mcpImportSchema = z.object({
  mcpServers: z.record(z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().url().optional(),
  })),
});

export const integrationRunToolSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});

export const integrationSettingsSchema = z.object({
  allowedProviderIds: z.array(z.string()).optional(),
  healthPollingEnabled: z.boolean().optional(),
  healthPollIntervalMs: z.number().int().min(30_000).optional(),
  catalogRemoteUrl: z.string().url().optional().or(z.literal('')),
  oauthClientIds: z.record(z.string()).optional(),
  showCandidateProviders: z.boolean().optional(),
});

// ─── Memory fabric schemas ──────────────────────────────────────

export const memoryNodeCategorySchema = z.enum(['persona', 'tool', 'episodic', 'semantic', 'source_doc', 'system']);
export const memoryEdgeTypeSchema = z.enum([
  'CONTAINS', 'REFERENCES', 'NEXT_STEP', 'REQUIRES', 'RELATED_TO', 'GENERATED_OUTPUT', 'USING_TOOL', 'SHARED_INSIGHT',
  'CAUSES', 'IS_A', 'PART_OF', 'HAS_PROPERTY', 'LOCATED_IN', 'OCCURRED_IN', 'MENTIONS', 'LEADS_TO', 'INFLUENCES',
  'CONTRIBUTES_TO', 'RESULTS_IN', 'DESCRIBES', 'EXAMPLES', 'OPPOSES', 'SYNONYM', 'PRECEDES', 'FOLLOWS',
]);

export const memoryNodeCreateSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1, 'label is required'),
  category: memoryNodeCategorySchema,
  content: z.string().min(1, 'content is required'),
  embedding: z.array(z.number()).optional(),
  sourceId: z.string().uuid().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(['active', 'failed', 'decayed', 'archived']).optional(),
  tag: z.string().optional(),
  isBenchmark: z.boolean().optional(),
});

export const memoryEdgeCreateSchema = z.object({
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  relationshipType: memoryEdgeTypeSchema,
  weight: z.number().min(0).max(1).optional(),
});

export const memorySearchSchema = z.object({
  embedding: z.array(z.number()),
  limit: z.number().int().min(1).max(100).optional(),
  category: memoryNodeCategorySchema.optional(),
  agentId: z.string().optional(),
});

export const memoryGraphWalkSchema = z.object({
  startNodeIds: z.array(z.string().uuid()).min(1),
  maxDepth: z.number().int().min(1).max(10).optional(),
  maxFanOut: z.number().int().min(1).max(100).optional(),
  minWeight: z.number().min(0).max(1).optional(),
  relationshipTypes: z.array(memoryEdgeTypeSchema).optional(),
});

export const memoryContextSchema = z.object({
  query: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  embedding: z.array(z.number()).optional(),
  agentId: z.string().optional(),
  episodicLimit: z.number().int().min(1).max(100).optional(),
  semanticLimit: z.number().int().min(1).max(100).optional(),
  graphDepth: z.number().int().min(1).max(10).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  useWeights: z.boolean().optional(),
});

export const memorySourceCreateSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  colorHex: z.string().min(1),
});

export const documentIngestSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['pdf', 'web', 'markdown', 'text', 'json']),
  content: z.string().min(1),
  colorHex: z.string().optional(),
  sourceId: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  chunkSize: z.number().int().min(100).max(5000).optional(),
  chunkOverlap: z.number().int().min(0).max(1000).optional(),
  maxEntitiesPerChunk: z.number().int().min(1).max(100).optional(),
  maxChunks: z.number().int().min(1).max(200).optional(),
});

export const benchmarkRunSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  tag: z.string().optional(),
});


