export type SessionEvent =
  | { type: 'step_started'; sessionId: string; sequence: number; timestamp: number; payload: { step: number } }
  | { type: 'step_ended'; sessionId: string; sequence: number; timestamp: number; payload: { step: number; usage?: { inputTokens: number; outputTokens: number } } }
  | { type: 'text_delta'; sessionId: string; sequence: number; timestamp: number; payload: { content: string; fullContent: string } }
  | { type: 'tool_called'; sessionId: string; sequence: number; timestamp: number; payload: { tool: string; callId: string; args: Record<string, unknown> } }
  | { type: 'tool_result'; sessionId: string; sequence: number; timestamp: number; payload: { tool: string; callId: string; success: boolean; output: string; elapsed: number } }
  | { type: 'finish'; sessionId: string; sequence: number; timestamp: number; payload: { content: string; usage?: { inputTokens: number; outputTokens: number } } }
  | { type: 'error'; sessionId: string; sequence: number; timestamp: number; payload: { code: string; message: string } }
  | { type: 'abort'; sessionId: string; sequence: number; timestamp: number; payload: { reason: string } };
