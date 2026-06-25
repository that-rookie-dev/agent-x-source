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

export const chatMessageSchema = z.object({
  text: z.string().min(1, 'text is required'),
  attachments: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })).optional(),
  retry: z.boolean().optional(),
  delegateCrewIds: z.array(z.string()).optional(),
  /** Set after user skips/deploys from CrewSuggestionModal — prevents server re-prompt. */
  crewSuggestionResolved: z.boolean().optional(),
  /** After in-chat crew roster picker — lead crew asks intake question first. */
  crewIntakeFromPicker: z.boolean().optional(),
  primaryCrewId: z.string().optional(),
  priorUserMessages: z.array(z.string()).optional(),
  resumeCrewIntake: z.object({
    originalUserText: z.string(),
    intakeAnswer: z.string(),
    delegateCrewIds: z.array(z.string()),
    primaryCrewId: z.string().optional(),
  }).optional(),
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
});

export const clarificationRespondSchema = z.object({
  response: z.string().min(1, 'response is required'),
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

export const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
  permissionLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  maxOutputSize: z.number().positive().optional(),
});
