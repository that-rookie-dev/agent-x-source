import { useState, useCallback, useRef, useEffect } from 'react';
import { messageBus } from './messageBus';
import { vscodeApi } from './vscodeApi';
import { ChatContainer } from './components/ChatContainer';
import { InputArea } from './components/InputArea';
import { StatusBar } from './components/StatusBar';
import { PermissionModal } from './components/PermissionModal';
import { ErrorBanner } from './components/ErrorBanner';
import { WelcomeScreen } from './components/WelcomeScreen';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  tokenCost?: number;
  toolName?: string;
  toolStatus?: 'running' | 'success' | 'error';
  toolResult?: string;
  toolElapsed?: number;
}

export interface StreamState {
  active: boolean;
  content: string;
}

export interface ToolState {
  tool: string;
  description: string;
  startTime: number;
  status: 'running' | 'success' | 'error';
  result?: string;
  elapsed?: number;
}

export interface PermissionRequest {
  requestId: string;
  tool: string;
  path: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface PlanState {
  planId: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed';
  steps: PlanStep[];
}

export interface PlanStep {
  stepId: string;
  description: string;
  status: 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

export interface SubAgentState {
  agentId: string;
  task: string;
  status: 'running' | 'complete';
  startTime: number;
  summary?: string;
  elapsed?: number;
}

export interface ReasoningState {
  active: boolean;
  text: string;
}

export interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in-progress' | 'completed';
}

export interface DiffState {
  tool: string;
  filePath: string;
  diff: string;
  oldContent: string;
  newContent: string;
}

export interface StatusState {
  provider: string;
  model: string;
  tokens: {
    used: number;
    total: number;
    percentage: number;
    cost: number;
  };
  activeTools: number;
  subAgents: number;
}

export interface ErrorState {
  code: string;
  message: string;
  recoverable: boolean;
  actions?: Array<{ label: string; action: string }>;
}

export interface BackgroundTask {
  id: string;
  command: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: string;
  createdAt: number;
  completedAt?: number;
}

export interface ThoughtNodeState {
  id: string;
  content: string;
  score: number;
  parentId?: string;
  depth: number;
}

export interface ResearchQueryState {
  id: string;
  question: string;
  sources: string;
  status: 'pending' | 'running' | 'complete';
  answer?: string;
  elapsed?: number;
}

interface ToTState {
  thoughts: ThoughtNodeState[];
  scores: Record<string, number>;
  bestThoughtId?: string;
  isComplete: boolean;
  problem: string;
}

interface ResearchState {
  question: string;
  queries: ResearchQueryState[];
  synthesizedReport?: string;
  isComplete: boolean;
}

interface AppState {
  messages: ChatMessage[];
  stream: StreamState;
  tools: Map<string, ToolState>;
  permission: PermissionRequest | null;
  permissions: PermissionRequest[];
  plan: PlanState | null;
  subAgents: SubAgentState[];
  reasoning: ReasoningState;
  todos: TodoItem[];
  diff: DiffState | null;
  status: StatusState;
  error: ErrorState | null;
  isProcessing: boolean;
  showWelcome: boolean;
  backgroundTasks: BackgroundTask[];
  treeOfThoughts: ToTState | null;
  research: ResearchState | null;
}

export function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = vscodeApi.getState<AppState>();
    return saved || {
      messages: [],
      stream: { active: false, content: '' },
      tools: new Map(),
      permission: null,
      permissions: [],
      plan: null,
      subAgents: [],
      reasoning: { active: false, text: '' },
      todos: [],
      diff: null,
      status: {
        provider: '',
        model: '',
        tokens: { used: 0, total: 0, percentage: 0, cost: 0 },
        activeTools: 0,
        subAgents: 0,
      },
      error: null,
      isProcessing: false,
      showWelcome: true,
      backgroundTasks: [],
      treeOfThoughts: null,
      research: null,
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    vscodeApi.setState(state);
  }, [state]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(messageBus.on<ChatMessage>('appendMessage', (msg) => {
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, msg],
        showWelcome: false,
      }));
    }));

    unsubs.push(messageBus.on<{ content: string; fullContent: string }>('updateStream', (data) => {
      setState((prev) => ({
        ...prev,
        stream: { active: true, content: data.fullContent },
      }));
    }));

    unsubs.push(messageBus.on('streamStart', () => {
      setState((prev) => ({
        ...prev,
        stream: { active: true, content: '' },
        isProcessing: true,
      }));
    }));

    unsubs.push(messageBus.on('streamEnd', () => {
      setState((prev) => {
        const streamContent = prev.stream.content;
        const newMsg: ChatMessage = {
          id: `stream-${Date.now()}`,
          role: 'assistant',
          content: streamContent,
          timestamp: Date.now(),
        };
        return {
          ...prev,
          stream: { active: false, content: '' },
          messages: [...prev.messages, newMsg],
          isProcessing: false,
        };
      });
    }));

    unsubs.push(messageBus.on<{ tool: string; description: string; startTime: number }>('toolExecuting', (data) => {
      setState((prev) => {
        const tools = new Map(prev.tools);
        tools.set(data.tool, { ...data, status: 'running' });
        return {
          ...prev,
          tools,
          status: { ...prev.status, activeTools: tools.size },
        };
      });
    }));

    unsubs.push(messageBus.on<{ tool: string; result: string; elapsed: number }>('toolComplete', (data) => {
      setState((prev) => {
        const tools = new Map(prev.tools);
        const existing = tools.get(data.tool);
        if (existing) {
          tools.set(data.tool, {
            ...existing,
            status: typeof data.result === 'string' && data.result.startsWith('ERROR') ? 'error' : 'success',
            result: data.result,
            elapsed: data.elapsed,
          });
        }
        return { ...prev, tools };
      });
    }));

    unsubs.push(messageBus.on<PermissionRequest>('permissionRequired', (data) => {
      setState((prev) => ({
        ...prev,
        permission: data,
        permissions: [...prev.permissions, data],
      }));
    }));

    unsubs.push(messageBus.on<{ action: string; plan?: PlanState; stepId?: string; status?: string; result?: string; error?: string }>('planUpdate', (data) => {
      setState((prev) => {
        if (data.action === 'generated' && data.plan) {
          return { ...prev, plan: data.plan };
        }
        if (data.action === 'stepUpdate' && prev.plan) {
          const steps = prev.plan.steps.map((s) =>
            s.stepId === data.stepId
              ? { ...s, status: data.status as PlanStep['status'], result: data.result, error: data.error }
              : s,
          );
          return { ...prev, plan: { ...prev.plan, steps } };
        }
        return prev;
      });
    }));

    unsubs.push(messageBus.on<SubAgentState>('subAgentUpdate', (data) => {
      setState((prev) => {
        const idx = prev.subAgents.findIndex((a) => a.agentId === data.agentId);
        const subAgents = [...prev.subAgents];
        if (idx >= 0) {
          subAgents[idx] = data;
        } else {
          subAgents.push(data);
        }
        return {
          ...prev,
          subAgents,
          status: { ...prev.status, subAgents: subAgents.filter((a) => a.status === 'running').length },
        };
      });
    }));

    unsubs.push(messageBus.on<{ action: string; text?: string }>('reasoningUpdate', (data) => {
      setState((prev) => ({
        ...prev,
        reasoning: {
          active: data.action !== 'complete',
          text: data.text || prev.reasoning.text,
        },
      }));
    }));

    unsubs.push(messageBus.on<{ items: TodoItem[] }>('todoUpdate', (data) => {
      setState((prev) => ({ ...prev, todos: data.items }));
    }));

    unsubs.push(messageBus.on<DiffState>('diffPreview', (data) => {
      setState((prev) => ({ ...prev, diff: data }));
    }));

    unsubs.push(messageBus.on<ErrorState>('error', (data) => {
      setState((prev) => ({ ...prev, error: data, isProcessing: false }));
    }));

    unsubs.push(messageBus.on('clearMessages', () => {
      setState((prev) => ({
        ...prev,
        messages: [],
        stream: { active: false, content: '' },
        tools: new Map(),
        plan: null,
        subAgents: [],
        reasoning: { active: false, text: '' },
        todos: [],
        diff: null,
        error: null,
        isProcessing: false,
        showWelcome: true,
        backgroundTasks: [],
        treeOfThoughts: null,
        research: null,
      }));
    }));

    unsubs.push(messageBus.on<{ messages: ChatMessage[]; title: string }>('sessionRestored', (data) => {
      setState((prev) => ({
        ...prev,
        messages: data.messages,
        showWelcome: data.messages.length === 0,
      }));
    }));

    unsubs.push(messageBus.on<{ tokens?: StatusState['tokens']; provider?: string; model?: string }>('statusUpdate', (data) => {
      setState((prev) => ({
        ...prev,
        status: {
          ...prev.status,
          ...(data.tokens ? { tokens: data.tokens } : {}),
          ...(data.provider ? { provider: data.provider } : {}),
          ...(data.model ? { model: data.model } : {}),
        },
      }));
    }));

    unsubs.push(messageBus.on('loadingStart', () => {
      setState((prev) => ({ ...prev, isProcessing: true }));
    }));

    unsubs.push(messageBus.on('loadingEnd', () => {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }));

    unsubs.push(messageBus.on<BackgroundTask[]>('backgroundTasksUpdate', (data) => {
      setState((prev) => ({ ...prev, backgroundTasks: data }));
    }));

    unsubs.push(messageBus.on<{ state: ToTState }>('totUpdate', (data) => {
      setState((prev) => ({ ...prev, treeOfThoughts: data.state }));
    }));

    unsubs.push(messageBus.on<{ state: ResearchState }>('researchUpdate', (data) => {
      setState((prev) => ({ ...prev, research: data.state }));
    }));

    vscodeApi.postMessage('ready', {});

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, []);

  const handleSendMessage = useCallback((content: string) => {
    vscodeApi.postMessage('sendMessage', { content });
    setState((prev) => ({ ...prev, showWelcome: false, error: null }));
  }, []);

  const handleCancel = useCallback(() => {
    vscodeApi.postMessage('cancelProcessing', {});
  }, []);

  const handlePermissionRespond = useCallback((decision: 'allow-once' | 'allow-always' | 'deny') => {
    if (stateRef.current.permission) {
      vscodeApi.postMessage('permissionRespond', {
        requestId: stateRef.current.permission.requestId,
        decision,
      });
      setState((prev) => {
        const remaining = prev.permissions.filter((p) => p.requestId !== prev.permission?.requestId);
        return { ...prev, permission: remaining.length > 0 ? remaining[0]! : null, permissions: remaining };
      });
    }
  }, []);

  const handlePermissionBatchRespond = useCallback((decision: 'allow-once' | 'allow-always') => {
    vscodeApi.postMessage('permissionRespondBatch', { decision });
    setState((prev) => ({ ...prev, permission: null, permissions: [] }));
  }, []);

  const handlePlanApprove = useCallback(() => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage('planApprove', { planId: stateRef.current.plan.planId });
    }
  }, []);

  const handlePlanReject = useCallback(() => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage('planReject', { planId: stateRef.current.plan.planId });
    }
  }, []);

  const handleStepApprove = useCallback((stepId: string) => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage('stepApprove', { stepId, planId: stateRef.current.plan.planId });
    }
  }, []);

  const handleStepSkip = useCallback((stepId: string) => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage('stepSkip', { stepId, planId: stateRef.current.plan.planId });
    }
  }, []);

  const handleStepModify = useCallback((stepId: string, modification: string) => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage('stepModify', { stepId, planId: stateRef.current.plan.planId, modification });
    }
  }, []);

  const handleSteerMessage = useCallback((instruction: string) => {
    vscodeApi.postMessage('steerMessage', { instruction });
  }, []);

  const handleSubAgentCancel = useCallback((agentId: string) => {
    vscodeApi.postMessage('subAgentCancel', { agentId });
  }, []);

  const handleBackgroundTaskCancel = useCallback((taskId: string) => {
    vscodeApi.postMessage('backgroundTaskCancel', { taskId });
  }, []);

  const handleDismissError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const research = state.research
    ? (state.research.isComplete ? state.research.queries : null)
    : null;

  return (
    <div className="agentx-app">
      {state.error && (
        <ErrorBanner error={state.error} onDismiss={handleDismissError} onRetry={() => handleSendMessage('retry')} />
      )}
      {state.permission && (
        <PermissionModal
          request={state.permission}
          pendingCount={state.permissions.length}
          onRespond={handlePermissionRespond}
          onApproveAll={handlePermissionBatchRespond}
        />
      )}
      {state.showWelcome && state.messages.length === 0 ? (
        <WelcomeScreen onStartChat={handleSendMessage} />
      ) : (
        <ChatContainer
          messages={state.messages}
          stream={state.stream}
          tools={state.tools}
          plan={state.plan}
          subAgents={state.subAgents}
          reasoning={state.reasoning}
          todos={state.todos}
          diff={state.diff}
          backgroundTasks={state.backgroundTasks}
          treeOfThoughts={state.treeOfThoughts}
          research={research}
          onPlanApprove={handlePlanApprove}
          onPlanReject={handlePlanReject}
          onStepApprove={handleStepApprove}
          onStepSkip={handleStepSkip}
          onStepModify={handleStepModify}
          onSubAgentCancel={handleSubAgentCancel}
          onBackgroundTaskCancel={handleBackgroundTaskCancel}
        />
      )}
      <InputArea onSend={handleSendMessage} onCancel={handleCancel} onSteer={handleSteerMessage} isProcessing={state.isProcessing} />
      <StatusBar status={state.status} />
    </div>
  );
}
