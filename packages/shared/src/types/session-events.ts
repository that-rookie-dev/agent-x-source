export type SessionEvent =
  | { type: 'step_started'; sessionId: string; sequence: number; timestamp: number; payload: { step: number } }
  | { type: 'step_ended'; sessionId: string; sequence: number; timestamp: number; payload: { step: number; usage?: { inputTokens: number; outputTokens: number } } }
  | { type: 'text_delta'; sessionId: string; sequence: number; timestamp: number; payload: { content: string; fullContent: string } }
  | { type: 'tool_called'; sessionId: string; sequence: number; timestamp: number; payload: { tool: string; callId: string; args: Record<string, unknown> } }
  | { type: 'tool_result'; sessionId: string; sequence: number; timestamp: number; payload: { tool: string; callId: string; success: boolean; output: string; elapsed: number } }
  | { type: 'finish'; sessionId: string; sequence: number; timestamp: number; payload: { content: string; usage?: { inputTokens: number; outputTokens: number } } }
  | { type: 'error'; sessionId: string; sequence: number; timestamp: number; payload: { code: string; message: string } }
  | { type: 'abort'; sessionId: string; sequence: number; timestamp: number; payload: { reason: string } }
  // Task lifecycle events for autonomous execution persistence
  | { type: 'task_started'; sessionId: string; sequence: number; timestamp: number; payload: { taskId: string; goal: string; stepCount: number } }
  | { type: 'task_step_completed'; sessionId: string; sequence: number; timestamp: number; payload: { taskId: string; stepIndex: number; totalSteps: number; description: string; status: string; result?: string } }
  | { type: 'task_completed'; sessionId: string; sequence: number; timestamp: number; payload: { taskId: string; success: boolean; summary: string; completedSteps: number; totalSteps: number } }
  | { type: 'task_interrupted'; sessionId: string; sequence: number; timestamp: number; payload: { taskId?: string; goal?: string; lastStepIndex?: number; totalSteps?: number; lastEventType?: string } }
  | { type: 'task_progress'; sessionId: string; sequence: number; timestamp: number; payload: { taskId: string; goal: string; phase: string; stepIndex: number; completedSteps: number; totalSteps: number; percent: number } }
  | { type: 'crew_mission_snapshot'; sessionId: string; sequence: number; timestamp: number; payload: { missionId: string; phase: string; success?: boolean; snapshot: Record<string, unknown> } };
