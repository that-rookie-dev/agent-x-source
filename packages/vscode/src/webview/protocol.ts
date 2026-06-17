export interface ExtensionToWebviewMessages {
  appendMessage: {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    tokenCost?: number;
    toolName?: string;
    toolStatus?: 'running' | 'success' | 'error';
    toolElapsed?: number;
  };
  updateStream: {
    content: string;
    fullContent: string;
  };
  streamStart: Record<string, never>;
  streamEnd: Record<string, never>;
  toolExecuting: {
    tool: string;
    description: string;
    startTime: number;
  };
  toolComplete: {
    tool: string;
    result: string;
    elapsed: number;
  };
  permissionRequired: {
    requestId: string;
    tool: string;
    path: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  };
  planUpdate: {
    action: 'generated' | 'stepUpdate';
    plan?: {
      planId: string;
      title: string;
      status: string;
      steps: Array<{
        stepId: string;
        description: string;
        status: string;
        result?: string;
        error?: string;
      }>;
    };
    userRequest?: string;
    stepId?: string;
    planId?: string;
    status?: string;
    result?: string;
    error?: string;
  };
  subAgentUpdate: {
    agentId: string;
    task: string;
    status: 'running' | 'complete';
    startTime: number;
    summary?: string;
    elapsed?: number;
  };
  reasoningUpdate: {
    action: 'start' | 'glimpse' | 'complete';
    text?: string;
  };
  todoUpdate: {
    items: Array<{
      id: string;
      text: string;
      status: 'pending' | 'in-progress' | 'completed';
    }>;
  };
  diffPreview: {
    tool: string;
    filePath: string;
    diff: string;
    oldContent: string;
    newContent: string;
  };
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    actions?: Array<{ label: string; action: string }>;
  };
  clearMessages: Record<string, never>;
  sessionRestored: {
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
    }>;
    title: string;
  };
  statusUpdate: {
    tokens?: {
      used: number;
      total: number;
      percentage: number;
      cost: number;
    };
    provider?: string;
    model?: string;
    workspaceRoot?: string;
  };
  loadingStart: {
    stage: string;
  };
  loadingEnd: Record<string, never>;
  processingUpdate: {
    taskDescription: string;
    stage: string;
    progress: number;
  } | null;
  clarification: {
    questionId: string;
    question: string;
    options: string[];
    allowFreeform: boolean;
  };
  indexingUpdate: {
    isActive: boolean;
    indexed: number;
    total: number;
    currentFile: string | null;
    chunks: number | null;
  };
  researchUpdate: {
    isActive: boolean;
    question: string | null;
    queries: Array<{
      queryId: string;
      question: string;
      sources: string;
      completed: boolean;
      result?: { answer: string; sources: string[]; elapsed: number };
    }>;
    synthesisResultCount: number | null;
    report: string | null;
  };
  compactionUpdate: {
    type: 'start' | 'complete';
    currentTokens?: number;
    threshold?: number;
    saved?: number;
  };
  watchEvent: {
    event: string;
    filePath: string;
    command: string;
    timestamp: number;
  };
  backgroundTaskUpdate: {
    taskId: string;
    summary?: string;
  };
  reminderFired: {
    taskId: string;
    name: string;
    message: string;
  };
}

export interface WebviewToExtensionMessages {
  sendMessage: {
    content: string;
  };
  cancelProcessing: Record<string, never>;
  permissionRespond: {
    requestId: string;
    decision: 'allow-once' | 'allow-always' | 'deny';
  };
  permissionRespondBatch: {
    decision: 'allow-once' | 'allow-always';
  };
  planApprove: {
    planId: string;
  };
  planReject: {
    planId: string;
  };
  stepApprove: {
    stepId: string;
    planId: string;
  };
  stepSkip: {
    stepId: string;
    planId: string;
  };
  stepModify: {
    stepId: string;
    planId: string;
    modification: string;
  };
  clarificationResponse: {
    questionId: string;
    response: string;
  };
  steerMessage: {
    instruction: string;
  };
  ready: Record<string, never>;
  scrollToBottom: Record<string, never>;
}
