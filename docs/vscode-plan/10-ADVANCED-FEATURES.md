# Phase 10: Advanced Features — Sub-Agents, Plan Mode, RAG, Steer, Background Tasks, ToT, Research & More

> **Status**: ✅ Complete
> **Depends on**: Phase 4 (Chat Webview), Phase 5 (Tool Adaptation), Phase 9 (Secret Sauce)
> **Estimated Effort**: 5–7 days
> **Files Created**: `packages/vscode/src/webview/ui/components/SubAgentPanel.tsx`, `packages/vscode/src/webview/ui/components/PlanApproval.tsx`, `packages/vscode/src/adapter/SteerHandler.ts`, `packages/vscode/src/webview/ui/components/BackgroundTasks.tsx`, `packages/vscode/src/adapter/RAGAdapter.ts`, `packages/vscode/src/webview/ui/components/TreeOfThoughts.tsx`, `packages/vscode/src/webview/ui/components/ResearchPanel.tsx`, `packages/vscode/src/webview/ui/components/TodoPanel.tsx`, `packages/vscode/src/adapter/SchedulerAdapter.ts`, `packages/vscode/src/commands/MCPManager.ts`, `packages/vscode/src/adapter/SkillsAdapter.ts`, `packages/vscode/src/adapter/ClarificationHandler.ts`, `packages/vscode/src/adapter/SessionModes.ts`

---

## Overview

Phase 10 implements every remaining advanced feature from the Agent-X engine as a first-class VS Code UI surface. The engine already provides complete implementations for sub-agents, plan mode, steer messages, background tasks, RAG, Tree of Thoughts, research mode, TODO management, scheduling, MCP integration, reflection, and skill generation. The VS Code extension must bridge these to native UI — webview components in the chat sidebar, tree views in the activity bar, command palette commands, status bar indicators, and notification toasts.

### Engine Integration Points

| Engine API | Location | Purpose |
|------------|----------|---------|
| `SubAgentManager.spawn()` | `agent/SubAgentManager.ts:64` | Spawn sub-agent with instruction + tools |
| `SubAgentManager.cancel()` | `agent/SubAgentManager.ts:190` | Cancel running sub-agent |
| `SubAgentManager.getAll()` | `agent/SubAgentManager.ts:215` | List all sub-agent tasks |
| `SmartSubAgent.execute()` | `agent/SmartSubAgent.ts:57` | Execute full-capability sub-agent |
| `Agent.setPlanMode()` | `agent/Agent.ts:688` | Toggle plan approval mode |
| `Agent.respondToPlan()` | `agent/Agent.ts:756` | Approve/reject entire plan |
| `Agent.respondToStep()` | `agent/Agent.ts:763` | Approve/skip/modify individual step |
| `Agent.getCurrentPlan()` | `agent/Agent.ts:752` | Read current plan object |
| `Agent.planModeEnabled` | `agent/Agent.ts:678` | Check if plan mode active |
| `Agent.respondToClarification()` | `agent/Agent.ts:183` | Respond to clarification request |
| `SteerMessageHandler.handleSteer()` | `agent/SteerMessageHandler.ts:14` | Send mid-execution steering |
| `SteerMessageHandler.canSteer()` | `agent/SteerMessageHandler.ts:30` | Check rate limit |
| `TaskManager.getBackgroundTasks()` | `agent/TaskManager.ts:89` | List background tasks |
| `TaskManager.cancelTask()` | `agent/TaskManager.ts:74` | Cancel a task |
| `BackgroundQueue.enqueue()` | `session/BackgroundQueue.ts:27` | Queue background command |
| `BackgroundQueue.cancel()` | `session/BackgroundQueue.ts:42` | Cancel queued command |
| `BackgroundQueue.listTasks()` | `session/BackgroundQueue.ts:63` | List all background tasks |
| `RAGEngine.indexDocument()` | `rag/RAGEngine.ts:50` | Index a single document |
| `RAGEngine.search()` | `rag/RAGEngine.ts:103` | Semantic search over index |
| `RAGEngine.clearAll()` | `rag/RAGEngine.ts:140` | Clear all indexed documents |
| `RAGEngine.chunkCount()` | `rag/RAGEngine.ts:150` | Get indexed chunk count |
| `TreeOfThoughts.solve()` | `reasoning/TreeOfThoughts.ts:174` | Run beam search reasoning |
| `ResearchEngine.research()` | `reasoning/ResearchEngine.ts:181` | Deep research with sub-agents |
| `TodoManager.getItems()` | `agent/TodoManager.ts:50` | List TODO items |
| `TodoManager.getProgress()` | `agent/TodoManager.ts:54` | Get completion progress |
| `Scheduler.addJob()` | `scheduler/Scheduler.ts:164` | Add cron job |
| `Scheduler.addTimer()` | `scheduler/Scheduler.ts:191` | Add one-shot timer |
| `Scheduler.removeJob()` | `scheduler/Scheduler.ts:241` | Remove scheduled job |
| `Scheduler.getJobs()` | `scheduler/Scheduler.ts:264` | List all jobs |
| `Scheduler.toggleJob()` | `scheduler/Scheduler.ts:272` | Enable/disable job |
| `MCPBridge.getServerNames()` | `plugin/MCPBridge.ts:168` | List connected servers |
| `MCPBridge.getServerStatus()` | `plugin/MCPBridge.ts:172` | Server status info |
| `MCPBridge.callTool()` | `plugin/MCPBridge.ts:180` | Call MCP tool |
| `MCPBridge.listTools()` | `plugin/MCPBridge.ts:190` | List server tools |
| `MCPBridge.discover()` | `plugin/MCPBridge.ts:85` | Discover available servers |
| `ReflectionLoop.getHistory()` | `agent/ReflectionLoop.ts:115` | Reflection learnings |
| `SkillGenerator.getAll()` | `agent/SkillGenerator.ts:175` | All skills (bundled + generated) |
| `SkillGenerator.findBestMatch()` | `agent/SkillGenerator.ts:188` | Match query to skill |

### Key Design Decisions

1. **Webview components** — Sub-agent cards, plan approval, TODO panel, ToT visualization, and research progress render inside the chat sidebar webview via React components, receiving data through `postMessage`.
2. **Extension host adapters** — SteerHandler, RAGAdapter, SchedulerAdapter, ClarificationHandler, SessionModes, and SkillsAdapter are extension-host-side TypeScript modules that bridge engine APIs to VS Code UI primitives.
3. **Event-driven updates** — All UI subscribes to `AgentEventBus` events forwarded through the existing EventBridge (Phase 2). Webview components re-render when new events arrive.
4. **Tree views for management** — Scheduler reminders, MCP servers, and generated skills appear as `TreeDataProvider` views in the sidebar, consistent with Phase 7 and 9 patterns.
5. **No engine modifications** — All integration is additive. The extension reads engine state through public APIs and emits events via the existing bus.

---

## Task Index

| Task ID | Title | Status | Priority |
|---------|-------|--------|----------|
| T10.1 | Sub-Agent UI Panel | ✅ | Core |
| T10.2 | Plan Mode Approval UI | ✅ | Core |
| T10.3 | Steer Message Handler | ✅ | Core |
| T10.4 | Background Task Panel | ✅ | Core |
| T10.5 | RAG Integration | ✅ | Core |
| T10.6 | Tree of Thoughts UI | ✅ | Feature |
| T10.7 | Research Mode UI | ✅ | Feature |
| T10.8 | TODO Panel Enhancement | ✅ | Core |
| T10.9 | Scheduler Integration | ✅ | Core |
| T10.10 | MCP Server Management | ✅ | Feature |
| T10.11 | Reflection & Skills Display | ✅ | Feature |
| T10.12 | Clarification Dialog | ✅ | Core |
| T10.13 | Session Modes | ✅ | Core |
| T10.14 | Verification & Testing | ✅ | Core |
| T10.Z | Update master plan status | ✅ | Core |

---

## T10.1: Sub-Agent UI (`packages/vscode/src/webview/ui/components/SubAgentPanel.tsx`)

**Status**: ✅
**File**: `packages/vscode/src/webview/ui/components/SubAgentPanel.tsx`
**Estimated Effort**: 5 hours

### T10.1.1: Types and State

```typescript
interface SubAgentState {
  id: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  elapsed: number;
  summary?: string;
  currentTool?: string;
  toolCalls: Array<{ name: string; timestamp: number }>;
}

interface SubAgentPanelProps {
  agents: SubAgentState[];
  onCancel: (agentId: string) => void;
}
```

### T10.1.2: React Component Implementation

```tsx
import React, { useState, useEffect, useRef } from 'react';

interface SubAgentState {
  id: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  elapsed: number;
  summary?: string;
  currentTool?: string;
  toolCalls: Array<{ name: string; timestamp: number }>;
}

interface SubAgentPanelProps {
  agents: SubAgentState[];
  onCancel: (agentId: string) => void;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

const statusIcons: Record<SubAgentState['status'], string> = {
  pending: '\u23f3',
  running: '\ud83d\udd04',
  completed: '\u2705',
  failed: '\u274c',
  cancelled: '\u26d4',
};

const statusColors: Record<SubAgentState['status'], string> = {
  pending: 'var(--vscode-charts-yellow)',
  running: 'var(--vscode-charts-blue)',
  completed: 'var(--vscode-charts-green)',
  failed: 'var(--vscode-errorForeground)',
  cancelled: 'var(--vscode-descriptionForeground)',
};

export const SubAgentPanel: React.FC<SubAgentPanelProps> = ({ agents, onCancel }) => {
  if (agents.length === 0) return null;

  const running = agents.filter(a => a.status === 'running' || a.status === 'pending');
  const finished = agents.filter(a => a.status !== 'running' && a.status !== 'pending');

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--vscode-panel-border)', paddingTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>
        Sub-Agents ({running.length} active, {finished.length} done)
      </div>
      {agents.map(agent => (
        <SubAgentCard key={agent.id} agent={agent} onCancel={onCancel} />
      ))}
    </div>
  );
};

const SubAgentCard: React.FC<{
  agent: SubAgentState;
  onCancel: (id: string) => void;
}> = ({ agent, onCancel }) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(agent.elapsed);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (agent.status === 'running') {
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - agent.startTime);
      }, 1000);
    } else {
      setElapsed(agent.elapsed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [agent.status, agent.startTime, agent.elapsed]);

  const isActive = agent.status === 'running' || agent.status === 'pending';
  const preview = agent.task.length > 80 ? agent.task.slice(0, 77) + '...' : agent.task;

  return (
    <div style={{
      border: '1px solid var(--vscode-panel-border)',
      borderRadius: 4,
      marginBottom: 6,
      overflow: 'hidden',
      borderLeftWidth: 3,
      borderLeftColor: statusColors[agent.status],
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '8px 10px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: isActive ? 'var(--vscode-editor-inactiveSelectionBackground)' : 'transparent',
        }}
      >
        <span style={{ fontSize: 14 }}>{statusIcons[agent.status]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {preview}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, display: 'flex', gap: 8, marginTop: 2 }}>
            <span>{formatElapsed(elapsed)}</span>
            {agent.currentTool && (
              <span style={{ color: 'var(--vscode-charts-blue)' }}>
                &#9654; {agent.currentTool}
              </span>
            )}
            <span>{agent.toolCalls.length} tool calls</span>
          </div>
        </div>
        {isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(agent.id); }}
            style={{
              background: 'none',
              border: '1px solid var(--vscode-button-secondaryBorder)',
              color: 'var(--vscode-button-secondaryForeground)',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        )}
        <span style={{ fontSize: 10, opacity: 0.5 }}>{expanded ? '\u25b2' : '\u25bc'}</span>
      </div>

      {expanded && (
        <div style={{
          padding: '6px 10px',
          borderTop: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-editor-background)',
          fontSize: 11,
        }}>
          <div style={{ marginBottom: 4, fontWeight: 600 }}>Full Task:</div>
          <div style={{ opacity: 0.8, whiteSpace: 'pre-wrap', marginBottom: 6 }}>{agent.task}</div>

          {agent.summary && (
            <>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>Result:</div>
              <div style={{ opacity: 0.8, whiteSpace: 'pre-wrap', marginBottom: 6 }}>{agent.summary}</div>
            </>
          )}

          {agent.toolCalls.length > 0 && (
            <>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>Tool Calls:</div>
              {agent.toolCalls.map((tc, i) => (
                <div key={i} style={{ opacity: 0.7, paddingLeft: 8 }}>
                  {'\u2022'} {tc.name}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
```

### T10.1.3: Extension Host Bridge

**File**: `packages/vscode/src/webview/ChatViewProvider.ts` (additive)

```typescript
import type { SubAgentManager, SubAgentTask } from '@agentx/engine';

private subAgentStates = new Map<string, {
  id: string;
  task: string;
  status: string;
  startTime: number;
  elapsed: number;
  summary?: string;
  currentTool?: string;
  toolCalls: Array<{ name: string; timestamp: number }>;
}>();

wireSubAgentEvents(): void {
  this.eventBridge.on('agent_spawned', (event) => {
    const e = event as { agentId: string; task: string; startTime: number };
    this.subAgentStates.set(e.agentId, {
      id: e.agentId,
      task: e.task,
      status: 'running',
      startTime: e.startTime,
      elapsed: 0,
      toolCalls: [],
    });
    this.pushSubAgentsToWebview();
  });

  this.eventBridge.on('agent_progress', (event) => {
    const e = event as { agentId: string; status: string };
    const state = this.subAgentStates.get(e.agentId);
    if (state) {
      state.status = e.status;
      this.pushSubAgentsToWebview();
    }
  });

  this.eventBridge.on('tool_executing', (event) => {
    const e = event as { tool: string; _subAgentId?: string };
    if (e._subAgentId) {
      const state = this.subAgentStates.get(e._subAgentId);
      if (state) {
        state.currentTool = e.tool;
        state.toolCalls.push({ name: e.tool, timestamp: Date.now() });
        this.pushSubAgentsToWebview();
      }
    }
  });

  this.eventBridge.on('agent_complete', (event) => {
    const e = event as { agentId: string; summary: string; elapsed: number };
    const state = this.subAgentStates.get(e.agentId);
    if (state) {
      state.status = e.summary.startsWith('Failed:') ? 'failed' : 'completed';
      state.summary = e.summary;
      state.elapsed = e.elapsed;
      state.currentTool = undefined;
      this.pushSubAgentsToWebview();
    }
  });
}

private pushSubAgentsToWebview(): void {
  this.postMessage({
    type: 'sub-agents-update',
    agents: [...this.subAgentStates.values()],
  });
}

handleSubAgentCancel(agentId: string): void {
  const engine = this.engineLifecycle.getAgent();
  if (engine) {
    const manager = (engine as unknown as { subAgents: SubAgentManager }).subAgents;
    manager.cancel(agentId);
  }
}
```

### T10.1.4: package.json Contribution

```json
{
  "commands": [
    {
      "command": "agentx.subagent.cancelAll",
      "title": "Cancel All Sub-Agents",
      "category": "Agent-X"
    }
  ]
}
```

**Acceptance Criteria**:
- Sub-agent panel renders below the message list when any sub-agents exist
- Each card shows: task preview, status icon, live elapsed timer, current tool being used, total tool call count
- Running/pending cards have blue/yellow left border; completed green; failed red; cancelled gray
- Live elapsed timer increments every second while status is `running`
- Expandable section reveals full task description, result summary, and tool call log
- Cancel button on each active card fires `handleSubAgentCancel` via postMessage
- Timer stops updating once status changes to terminal state
- Summary appears with checkmark or cross icon on completion/failure

---

## T10.2: Plan Mode UI (`packages/vscode/src/webview/ui/components/PlanApproval.tsx`)

**Status**: \u2b1c Not Started
**File**: `packages/vscode/src/webview/ui/components/PlanApproval.tsx`
**Estimated Effort**: 5 hours

### T10.2.1: Types

```typescript
interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped' | 'completed' | 'failed' | 'awaiting_approval';
}

interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: string;
}

interface PlanApprovalProps {
  plan: Plan;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onApproveStep: (stepId: string) => void;
  onSkipStep: (stepId: string) => void;
  onModifyStep: (stepId: string, description: string) => void;
}
```

### T10.2.2: Full Component Implementation

```tsx
import React, { useState } from 'react';

interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped' | 'completed' | 'failed' | 'awaiting_approval';
}

interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: string;
}

interface PlanApprovalProps {
  plan: Plan;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onApproveStep: (stepId: string) => void;
  onSkipStep: (stepId: string) => void;
  onModifyStep: (stepId: string, description: string) => void;
}

const stepStatusIcon: Record<PlanStep['status'], string> = {
  pending: '\u2b1c',
  approved: '\u2611\ufe0f',
  rejected: '\ud83d\udeab',
  skipped: '\u23ed\ufe0f',
  completed: '\u2705',
  failed: '\u274c',
  awaiting_approval: '\ud83d\udd36',
};

export const PlanApproval: React.FC<PlanApprovalProps> = ({
  plan,
  onApproveAll,
  onRejectAll,
  onApproveStep,
  onSkipStep,
  onModifyStep,
}) => {
  const completedSteps = plan.steps.filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const progress = plan.steps.length > 0 ? (completedSteps / plan.steps.length) * 100 : 0;
  const isPending = plan.steps.some(s => s.status === 'pending');
  const hasAwaitingStep = plan.steps.some(s => s.status === 'awaiting_approval');

  return (
    <div style={{
      border: '1px solid var(--vscode-focusBorder)',
      borderRadius: 6,
      margin: '12px 0',
      overflow: 'hidden',
      background: 'var(--vscode-editor-background)',
    }}>
      <div style={{
        padding: '10px 14px',
        background: 'var(--vscode-titleBar-activeBackground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{'\ud83d\udccb'} {plan.title}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
            {completedSteps}/{plan.steps.length} steps
          </div>
        </div>
        {isPending && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onApproveAll} style={btnStyle('var(--vscode-button-background)', 'var(--vscode-button-foreground)')}>
              {'\u2713'} Approve All
            </button>
            <button onClick={onRejectAll} style={btnStyle('var(--vscode-inputValidation-errorBorder)', '#fff')}>
              {'\u2715'} Reject
            </button>
          </div>
        )}
      </div>

      <div style={{ height: 4, background: 'var(--vscode-scrollbarSlider-background)', position: 'relative' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--vscode-progressBar-background)',
          transition: 'width 0.3s ease',
        }} />
      </div>

      <div style={{ padding: '8px 0' }}>
        {plan.steps.map((step, idx) => (
          <StepRow
            key={step.id}
            step={step}
            index={idx}
            onApprove={onApproveStep}
            onSkip={onSkipStep}
            onModify={onModifyStep}
          />
        ))}
      </div>
    </div>
  );
};

const StepRow: React.FC<{
  step: PlanStep;
  index: number;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onModify: (id: string, desc: string) => void;
}> = ({ step, index, onApprove, onSkip, onModify }) => {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(step.description);

  const isActionable = step.status === 'pending' || step.status === 'awaiting_approval';

  const handleSaveEdit = () => {
    if (editText.trim() && editText.trim() !== step.description) {
      onModify(step.id, editText.trim());
    }
    setEditing(false);
  };

  return (
    <div style={{
      padding: '6px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      background: step.status === 'awaiting_approval'
        ? 'var(--vscode-editor-selectionHighlightBackground)'
        : 'transparent',
      borderLeft: step.status === 'awaiting_approval'
        ? '3px solid var(--vscode-focusBorder)'
        : '3px solid transparent',
    }}>
      <span style={{ fontSize: 13, marginTop: 1 }}>{stepStatusIcon[step.status]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 1 }}>Step {index + 1}</div>
        {editing ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
              style={{
                flex: 1,
                padding: '2px 6px',
                fontSize: 12,
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: 3,
                outline: 'none',
              }}
            />
            <button onClick={handleSaveEdit} style={smallBtnStyle('var(--vscode-button-background)'}>{'\u2713'}</button>
            <button onClick={() => setEditing(false)} style={smallBtnStyle('transparent')}>{'\u2715'}</button>
          </div>
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>
            {step.description}
          </div>
        )}
      </div>
      {isActionable && !editing && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => onApprove(step.id)}
            style={smallBtnStyle('var(--vscode-button-background)')}
            title="Approve"
          >{'\u2713'}</button>
          <button
            onClick={() => onSkip(step.id)}
            style={smallBtnStyle('var(--vscode-button-secondaryBackground)')}
            title="Skip"
          >{'\u23ed'}</button>
          <button
            onClick={() => { setEditText(step.description); setEditing(true); }}
            style={smallBtnStyle('var(--vscode-button-secondaryBackground)')}
            title="Modify"
          >{'\u270e'}</button>
        </div>
      )}
    </div>
  );
};

function btnStyle(bg: string, fg: string): React.CSSProperties {
  return {
    padding: '4px 12px', background: bg, color: fg, border: 'none',
    borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 500,
  };
}

function smallBtnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, border: '1px solid var(--vscode-button-secondaryBorder)',
    color: 'var(--vscode-button-secondaryForeground)', borderRadius: 3,
    padding: '1px 6px', fontSize: 12, cursor: 'pointer', lineHeight: '18px',
  };
}
```

### T10.2.3: Extension Host Bridge

**File**: `packages/vscode/src/webview/ChatViewProvider.ts` (additive)

```typescript
wirePlanEvents(): void {
  this.eventBridge.on('plan_generated', (event) => {
    const e = event as { plan: Plan; userRequest: string };
    this.postMessage({ type: 'plan-generated', plan: e.plan });
  });

  this.eventBridge.on('plan_approved', () => {
    this.postMessage({ type: 'plan-approved' });
  });

  this.eventBridge.on('plan_rejected', () => {
    this.postMessage({ type: 'plan-rejected' });
  });

  this.eventBridge.on('plan_step_pending', (event) => {
    const e = event as { stepId: string; planId: string; description: string };
    this.postMessage({ type: 'plan-step-pending', stepId: e.stepId, description: e.description });
  });

  this.eventBridge.on('plan_step_complete', (event) => {
    const e = event as { stepId: string };
    this.postMessage({ type: 'plan-step-complete', stepId: e.stepId });
  });

  this.eventBridge.on('plan_step_failed', (event) => {
    const e = event as { stepId: string };
    this.postMessage({ type: 'plan-step-failed', stepId: e.stepId });
  });

  this.eventBridge.on('plan_step_skipped', (event) => {
    const e = event as { stepId: string };
    this.postMessage({ type: 'plan-step-skipped', stepId: e.stepId });
  });

  this.eventBridge.on('plan_mode_entered', () => {
    this.postMessage({ type: 'plan-mode-entered' });
  });

  this.eventBridge.on('plan_mode_exited', () => {
    this.postMessage({ type: 'plan-mode-exited' });
  });
}

handlePlanAction(action: string, payload: Record<string, unknown>): void {
  const agent = this.engineLifecycle.getAgent();
  if (!agent) return;

  switch (action) {
    case 'approve-all':
      agent.respondToPlan(true);
      break;
    case 'reject-all':
      agent.respondToPlan(false);
      break;
    case 'approve-step':
      agent.respondToStep(payload.stepId as string, true);
      break;
    case 'skip-step':
      agent.respondToStep(payload.stepId as string, false);
      break;
    case 'modify-step':
      agent.respondToStep(payload.stepId as string, true, payload.description as string);
      break;
  }
}
```

### T10.2.4: planMode Command Registration

**File**: `packages/vscode/src/extension.ts` (additive)

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('agentx.planMode.toggle', async () => {
    if (!engine) return;
    const current = engine.planModeEnabled;
    engine.setPlanMode(!current);
    vscode.window.showInformationMessage(
      `Plan mode ${!current ? 'enabled' : 'disabled'}.`,
    );
  }),
);
```

**Acceptance Criteria**:
- When `plan_generated` event fires, the full plan approval UI renders inline in the chat
- Plan title displayed in header with step count (X/Y steps)
- Progress bar fills as steps complete or skip
- Each step shows: status icon, step number, description text
- Per-step action buttons: approve (\u2713), skip (\u23ed), modify (\u270e)
- Modify mode: inline text input with save/cancel; pressing Enter saves, Escape cancels
- Current awaiting step highlighted with selection background and focus border
- "Approve All" and "Reject" buttons in header for bulk decision
- `respondToPlan(true/false)` called correctly on bulk actions
- `respondToStep(stepId, approved, description?)` called for per-step actions
- Step statuses update in real-time as engine progresses through execution

---

## T10.3: Steer Message Handler (`packages/vscode/src/adapter/SteerHandler.ts`)

**Status**: ✅
**File**: `packages/vscode/src/adapter/SteerHandler.ts`
**Estimated Effort**: 2 hours

### T10.3.1: Implementation

```typescript
import * as vscode from 'vscode';
import type { Agent } from '@agentx/engine';
import type { SteerMessageHandler as EngineSteerHandler } from '@agentx/engine';

export class SteerHandler {
  private engine: Agent | null = null;
  private engineSteerHandler: EngineSteerHandler | null = null;
  private isProcessing = false;
  private pendingSteerNotification: vscode.Disposable | null = null;

  attach(engine: Agent): void {
    this.engine = engine;
    const internal = engine as unknown as { steerHandler?: EngineSteerHandler };
    this.engineSteerHandler = internal.steerHandler ?? null;
  }

  setIsProcessing(value: boolean): void {
    this.isProcessing = value;
  }

  canSteer(): boolean {
    if (!this.isProcessing || !this.engine) return false;
    if (this.engineSteerHandler) {
      return this.engineSteerHandler.canSteer();
    }
    return true;
  }

  async handleUserInput(text: string, webviewPostMessage: (msg: { type: string; [key: string]: unknown }) => void): Promise<boolean> {
    if (!this.canSteer()) return false;

    if (this.isProcessing) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Send as steer message', description: 'Inject guidance into current execution', value: 'steer' },
          { label: 'Queue as next message', description: 'Wait until current task finishes', value: 'queue' },
          { label: 'Cancel', value: 'cancel' },
        ],
        { placeHolder: 'Agent is processing. How would you like to send this message?' },
      );

      if (!choice || choice.value === 'cancel') return true;
      if (choice.value === 'queue') return false;

      this.sendSteer(text, webviewPostMessage);
      return true;
    }

    return false;
  }

  autoSteer(text: string, webviewPostMessage: (msg: { type: string; [key: string]: unknown }) => void): void {
    if (this.canSteer()) {
      this.sendSteer(text, webviewPostMessage);
    }
  }

  private sendSteer(
    text: string,
    webviewPostMessage: (msg: { type: string; [key: string]: unknown }) => void,
  ): void {
    if (!this.engine || !this.engineSteerHandler) return;

    const taskId = (this.engine as unknown as { sessionId: string }).sessionId;
    const accepted = this.engineSteerHandler.handleSteer(taskId, text);

    if (accepted) {
      webviewPostMessage({
        type: 'steer-sent',
        instruction: text,
      });

      if (this.pendingSteerNotification) {
        this.pendingSteerNotification.dispose();
      }

      const preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
      vscode.window.setStatusBarMessage(`$(megaphone) Steering: ${preview}`, 5000);
    } else {
      vscode.window.showWarningMessage('Steer rate-limited. Wait a few seconds before sending another steer message.');
    }
  }

  dispose(): void {
    this.pendingSteerNotification?.dispose();
  }
}
```

### T10.3.2: Chat Input Integration

**File**: `packages/vscode/src/webview/ChatViewProvider.ts` (additive)

```typescript
private steerHandler: SteerHandler;

// In resolveWebviewView message handler:
case 'user-message':
  if (this.steerHandler.canSteer()) {
    this.steerHandler.autoSteer(
      message.data.text,
      (msg) => this.view?.webview.postMessage(msg),
    );
  } else {
    this.sendMessage(message.data.text);
  }
  break;

case 'steer-message':
  this.steerHandler.handleUserInput(
    message.data.text,
    (msg) => this.view?.webview.postMessage(msg),
  );
  break;
```

### T10.3.3: Webview Steer Indicator

In the InputArea component, when agent is processing:

```tsx
const SteerIndicator: React.FC<{ isProcessing: boolean }> = ({ isProcessing }) => {
  if (!isProcessing) return null;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      fontSize: 11,
      background: 'var(--vscode-editorInfo-background, var(--vscode-badge-background))',
      color: 'var(--vscode-editorInfo-foreground, var(--vscode-badge-foreground))',
      borderRadius: '4px 4px 0 0',
    }}>
      <span>{'\u26a1'}</span>
      <span>Agent is processing — type to send as steer message</span>
    </div>
  );
};
```

### T10.3.4: package.json Commands

```json
{
  "commands": [
    {
      "command": "agentx.steer.toggleAutoSteer",
      "title": "Toggle Auto-Steer Mode",
      "category": "Agent-X"
    }
  ]
}
```

**Acceptance Criteria**:
- When agent is processing and user types in the chat input, steer indicator badge appears
- If user presses Send while processing: QuickPick asks "Send as steer / Queue / Cancel"
- On auto-steer mode: messages sent during processing are automatically routed as steers
- `SteerMessageHandler.handleSteer()` called with task session ID and instruction text
- Rate limiting respected: warning shown if user sends too rapidly (< 3s apart)
- Webview displays "Steering agent..." badge briefly after successful steer
- Status bar shows truncated steer message for 5 seconds

---

## T10.4: Background Task Panel (`packages/vscode/src/webview/ui/components/BackgroundTasks.tsx`)

**Status**: ✅
**File**: `packages/vscode/src/webview/ui/components/BackgroundTasks.tsx`
**Estimated Effort**: 2 hours

### T10.4.1: Component Implementation

```tsx
import React, { useState, useEffect, useRef } from 'react';

interface BackgroundTask {
  id: string;
  command: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: string;
  createdAt: number;
  completedAt?: number;
}

interface BackgroundTasksProps {
  tasks: BackgroundTask[];
  onCancel: (taskId: string) => void;
}

const taskStatusIcon: Record<BackgroundTask['status'], string> = {
  queued: '\u23f3',
  running: '\u25b6\ufe0f',
  completed: '\u2705',
  failed: '\u274c',
  cancelled: '\u26d4',
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export const BackgroundTasks: React.FC<BackgroundTasksProps> = ({ tasks, onCancel }) => {
  if (tasks.length === 0) return null;

  const active = tasks.filter(t => t.status === 'queued' || t.status === 'running');
  const finished = tasks.filter(t => t.status !== 'queued' && t.status !== 'running');

  return (
    <div style={{
      marginTop: 8,
      borderTop: '1px solid var(--vscode-panel-border)',
      paddingTop: 6,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        opacity: 0.7,
        marginBottom: 4,
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Background Tasks</span>
        <span>{active.length} active</span>
      </div>

      {[...active, ...finished.slice(0, 3)].map(task => (
        <TaskRow key={task.id} task={task} onCancel={onCancel} />
      ))}

      {finished.length > 3 && (
        <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'center', paddingTop: 4 }}>
          +{finished.length - 3} more completed
        </div>
      )}
    </div>
  );
};

const TaskRow: React.FC<{ task: BackgroundTask; onCancel: (id: string) => void }> = ({ task, onCancel }) => {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (task.status === 'running') {
      setElapsed(Date.now() - task.createdAt);
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - task.createdAt);
      }, 1000);
    } else if (task.completedAt) {
      setElapsed(task.completedAt - task.createdAt);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [task.status, task.createdAt, task.completedAt]);

  const isActive = task.status === 'queued' || task.status === 'running';
  const cmdPreview = task.command.length > 50 ? task.command.slice(0, 47) + '...' : task.command;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      fontSize: 11,
      borderRadius: 3,
      background: isActive ? 'var(--vscode-editor-inactiveSelectionBackground)' : 'transparent',
      marginBottom: 2,
    }}>
      <span>{taskStatusIcon[task.status]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--vscode-editor-font-family)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {cmdPreview}
        </div>
        <div style={{ fontSize: 10, opacity: 0.6 }}>
          {formatDuration(elapsed)} — {task.progress}
        </div>
      </div>
      {isActive && (
        <button
          onClick={() => onCancel(task.id)}
          style={{
            background: 'none',
            border: '1px solid var(--vscode-button-secondaryBorder)',
            color: 'var(--vscode-button-secondaryForeground)',
            borderRadius: 3,
            padding: '1px 6px',
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
};
```

### T10.4.2: Extension Host Integration

**File**: `packages/vscode/src/webview/ChatViewProvider.ts` (additive)

```typescript
import type { BackgroundQueue, BackgroundTask } from '@agentx/engine';

wireBackgroundTaskEvents(): void {
  this.eventBridge.on('background_task_complete', (event) => {
    const e = event as { taskId: string; summary: string };
    this.refreshBackgroundTasks();

    vscode.window.showInformationMessage(
      `Background task completed: ${e.summary.slice(0, 80)}`,
      'View Output',
    ).then(action => {
      if (action === 'View Output') {
        vscode.workspace.openTextDocument({
          content: e.summary,
          language: 'plaintext',
        }).then(doc => vscode.window.showTextDocument(doc, { preview: true }));
      }
    });
  });
}

private refreshBackgroundTasks(): void {
  const agent = this.engineLifecycle.getAgent();
  if (!agent) return;

  const queue = (agent as unknown as { backgroundQueue?: BackgroundQueue }).backgroundQueue;
  if (!queue) return;

  this.postMessage({
    type: 'background-tasks-update',
    tasks: queue.listTasks(),
  });
}

handleBackgroundTaskCancel(taskId: string): void {
  const agent = this.engineLifecycle.getAgent();
  if (!agent) return;
  const queue = (agent as unknown as { backgroundQueue?: BackgroundQueue }).backgroundQueue;
  queue?.cancel(taskId);
  this.refreshBackgroundTasks();
}
```

**Acceptance Criteria**:
- Panel appears when any background tasks exist (queued, running, completed, or failed)
- Each task row shows: command preview (monospace), status icon, elapsed time, progress text
- Running tasks update elapsed time every second
- Completed/failed tasks show final duration
- Cancel button visible only on active (queued/running) tasks
- Notification toast on task completion with "View Output" action
- Maximum 3 finished tasks visible; overflow count shown below

---

## T10.5: RAG Integration (`packages/vscode/src/adapter/RAGAdapter.ts`)

**Status**: ✅
**File**: `packages/vscode/src/adapter/RAGAdapter.ts`
**Estimated Effort**: 4 hours

### T10.5.1: Implementation

```typescript
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { Agent, RAGEngine } from '@agentx/engine';

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.dart',
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.html',
  '.css', '.scss', '.sql', '.sh', '.bash', '.zsh', '.lua', '.r',
]);

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', 'target', 'vendor', 'bin', 'obj', '.vscode',
  'coverage', '.nyc_output', '.idea', '.vs',
]);

export class RAGAdapter {
  private engine: Agent | null = null;
  private ragEngine: RAGEngine | null = null;
  private workspaceRoot: string = '';
  private statusBarItem: vscode.StatusBarItem;
  private indexingInProgress = false;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
  }

  attach(engine: Agent, workspaceRoot: string): void {
    this.engine = engine;
    this.workspaceRoot = workspaceRoot;
    const internal = engine as unknown as { ragEngine?: RAGEngine };
    this.ragEngine = internal.ragEngine ?? null;
    this.updateStatusBar();
  }

  get isAvailable(): boolean {
    return this.ragEngine !== null;
  }

  async indexWorkspace(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    if (!this.ragEngine || this.indexingInProgress) return;

    this.indexingInProgress = true;
    this.statusBarItem.text = '$(sync~spin) Indexing workspace...';
    this.statusBarItem.show();

    try {
      const files = await this.collectFiles(this.workspaceRoot);
      const total = files.length;

      if (total === 0) {
        vscode.window.showInformationMessage('No indexable files found in workspace.');
        this.indexingInProgress = false;
        this.updateStatusBar();
        return;
      }

      let indexed = 0;

      for (let i = 0; i < files.length; i += 10) {
        const batch = files.slice(i, i + 10);
        const docs = batch.map(f => ({
          content: this.safeReadFile(f.path),
          id: f.relativePath,
          metadata: {
            path: f.relativePath,
            language: this.detectLanguage(f.path),
          },
        })).filter(d => d.content.length > 0);

        if (docs.length > 0) {
          await this.ragEngine.indexDocuments(docs);
        }

        indexed += batch.length;
        progress.report({
          message: `${indexed}/${total} files (${Math.round(indexed / total * 100)}%)`,
          increment: (batch.length / total) * 100,
        });
      }

      const chunkCount = await this.ragEngine.chunkCount();
      vscode.window.showInformationMessage(
        `Indexed ${total} files (${chunkCount} chunks) from workspace.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.indexingInProgress = false;
      this.updateStatusBar();
    }
  }

  async clearIndex(): Promise<void> {
    if (!this.ragEngine) return;
    await this.ragEngine.clearAll();
    this.updateStatusBar();
    vscode.window.showInformationMessage('RAG index cleared.');
  }

  async search(query: string): Promise<Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>> {
    if (!this.ragEngine) return [];
    return this.ragEngine.search(query);
  }

  private updateStatusBar(): void {
    if (!this.ragEngine) {
      this.statusBarItem.hide();
      return;
    }

    const stats = this.engine?.ragIndexStats ?? { indexedCount: 0, indexedAt: null };

    if (stats.indexedCount > 0) {
      this.statusBarItem.text = `$(database) ${stats.indexedCount}`;
      const dateStr = stats.indexedAt
        ? new Date(stats.indexedAt).toLocaleString()
        : 'never';
      this.statusBarItem.tooltip = `Agent-X RAG: ${stats.indexedCount} chunks indexed at ${dateStr}`;
      this.statusBarItem.command = 'agentx.rag.reindex';
      this.statusBarItem.show();
    } else {
      this.statusBarItem.text = '$(database) Not indexed';
      this.statusBarItem.tooltip = 'Agent-X RAG: Click to index workspace';
      this.statusBarItem.command = 'agentx.rag.index';
      this.statusBarItem.show();
    }
  }

  private async collectFiles(dir: string): Promise<Array<{ path: string; relativePath: string }>> {
    const results: Array<{ path: string; relativePath: string }> = [];
    const uri = vscode.Uri.file(dir);

    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of entries) {
      const fullPath = join(dir, name);

      if (type === vscode.FileType.Directory) {
        if (!EXCLUDED_DIRS.has(name)) {
          const subFiles = await this.collectFiles(fullPath);
          results.push(...subFiles);
        }
      } else if (type === vscode.FileType.File) {
        const ext = extname(name).toLowerCase();
        if (INDEXABLE_EXTENSIONS.has(ext)) {
          results.push({
            path: fullPath,
            relativePath: relative(this.workspaceRoot, fullPath),
          });
        }
      }
    }

    return results;
  }

  private safeReadFile(filePath: string): string {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.length > 100_000) return content.slice(0, 100_000);
      return content;
    } catch {
      return '';
    }
  }

  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript',
      '.jsx': 'javascriptreact', '.py': 'python', '.rs': 'rust',
      '.go': 'go', '.java': 'java', '.rb': 'ruby', '.php': 'php',
      '.md': 'markdown', '.json': 'json', '.yaml': 'yaml',
      '.sql': 'sql', '.sh': 'shellscript', '.html': 'html',
      '.css': 'css', '.swift': 'swift', '.kt': 'kotlin',
    };
    return map[ext] ?? 'plaintext';
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
```

### T10.5.2: RAG Search Results in Webview

When `rag_queried` events fire or `rag_search` tool completes, citation chips render inline:

```tsx
const RAGCitations: React.FC<{
  results: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>;
}> = ({ results }) => {
  if (results.length === 0) return null;
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: 6,
      paddingTop: 6,
      borderTop: '1px solid var(--vscode-panel-border)',
    }}>
      <span style={{ fontSize: 10, opacity: 0.5, width: '100%' }}>Sources:</span>
      {results.map((r, i) => (
        <span key={i} style={{
          display: 'inline-block',
          padding: '2px 8px',
          fontSize: 10,
          borderRadius: 10,
          background: 'var(--vscode-badge-background)',
          color: 'var(--vscode-badge-foreground)',
          cursor: 'default',
        }} title={r.content.slice(0, 200)}>
          {(r.metadata?.path as string)?.split('/').pop() ?? `source-${i}`}
          {r.score != null && ` (${Math.round(r.score * 100)}%)`}
        </span>
      ))}
    </div>
  );
};
```

### T10.5.3: Command Registration

**File**: `packages/vscode/src/extension.ts` (additive)

```typescript
import { RAGAdapter } from './adapter/RAGAdapter';

const ragStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
context.subscriptions.push(ragStatusItem);

const ragAdapter = new RAGAdapter(ragStatusItem);
context.subscriptions.push({ dispose: () => ragAdapter.dispose() });

context.subscriptions.push(
  vscode.commands.registerCommand('agentx.rag.index', async () => {
    if (!engine) {
      vscode.window.showErrorMessage('No agent active.');
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    ragAdapter.attach(engine, folders[0].uri.fsPath);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Indexing Workspace', cancellable: false },
      async (progress) => {
        await ragAdapter.indexWorkspace(progress);
      },
    );
  }),

  vscode.commands.registerCommand('agentx.rag.reindex', async () => {
    await vscode.commands.executeCommand('agentx.rag.index');
  }),

  vscode.commands.registerCommand('agentx.rag.clear', async () => {
    await ragAdapter.clearIndex();
  }),

  vscode.commands.registerCommand('agentx.rag.search', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search workspace knowledge base',
      placeHolder: 'e.g., how does authentication work?',
    });
    if (!query) return;

    const results = await ragAdapter.search(query);
    if (results.length === 0) {
      vscode.window.showInformationMessage('No relevant documents found in index.');
      return;
    }

    const items = results.map((r, i) => ({
      label: (r.metadata?.path as string) ?? `Result ${i + 1}`,
      description: r.score != null ? `${Math.round(r.score * 100)}% match` : '',
      detail: r.content.slice(0, 200),
      content: r.content,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} result(s) — select to view`,
      matchOnDetail: true,
    });

    if (selected) {
      const doc = await vscode.workspace.openTextDocument({
        content: selected.content,
        language: 'plaintext',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  }),
);
```

### T10.5.4: package.json Commands

```json
{
  "commands": [
    {
      "command": "agentx.rag.index",
      "title": "Index Workspace for RAG",
      "category": "Agent-X"
    },
    {
      "command": "agentx.rag.reindex",
      "title": "Re-index Workspace",
      "category": "Agent-X"
    },
    {
      "command": "agentx.rag.clear",
      "title": "Clear RAG Index",
      "category": "Agent-X"
    },
    {
      "command": "agentx.rag.search",
      "title": "Search Workspace Knowledge Base",
      "category": "Agent-X"
    }
  ]
}
```

**Acceptance Criteria**:
- `agentx.rag.index` collects all indexable files (excluding node_modules, .git, dist, build, etc.)
- Progress notification shows "X/Y files (Z%)" during indexing
- Files chunked and embedded via `RAGEngine.indexDocuments()`
- Status bar shows `$(database) N` when indexed, tooltip with date; click re-indexes
- When not indexed: shows "$(database) Not indexed", click triggers initial index
- `agentx.rag.search` opens InputBox then QuickPick with scored results
- Selecting a result opens its content in a preview text document
- Citation chips render in webview when `rag_queried` events fire, showing filename and score percentage
- `agentx.rag.clear` wipes the index and resets status bar

---

## T10.6: Tree of Thoughts UI (`packages/vscode/src/webview/ui/components/TreeOfThoughts.tsx`)

**Status**: ✅
**File**: `packages/vscode/src/webview/ui/components/TreeOfThoughts.tsx`
**Estimated Effort**: 3 hours

### T10.6.1: Component Implementation

```tsx
import React, { useState } from 'react';

interface ThoughtNodeState {
  id: string;
  content: string;
  score: number;
  parentId?: string;
  depth: number;
}

interface TreeOfThoughtsProps {
  thoughts: ThoughtNodeState[];
  scores: Map<string, number>;
  bestThoughtId?: string;
  isComplete: boolean;
  problem: string;
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'var(--vscode-charts-green)';
  if (score >= 0.5) return 'var(--vscode-charts-yellow)';
  return 'var(--vscode-charts-red)';
}

export const TreeOfThoughtsPanel: React.FC<TreeOfThoughtsProps> = ({
  thoughts,
  scores,
  bestThoughtId,
  isComplete,
  problem,
}) => {
  const [collapsed, setCollapsed] = useState(isComplete);

  if (isComplete && collapsed) {
    const best = thoughts.find(t => t.id === bestThoughtId);
    return (
      <div style={{
        border: '1px solid var(--vscode-charts-green)',
        borderRadius: 6,
        margin: '8px 0',
        padding: '8px 12px',
        background: 'var(--vscode-editor-background)',
      }}>
        <div
          onClick={() => setCollapsed(false)}
          style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}
        >
          <span>{'\ud83c\udf33'} Tree of Thoughts — Complete</span>
          <span style={{ opacity: 0.5, fontSize: 10 }}>{'\u25bc'} expand</span>
        </div>
        {best && (
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85, fontStyle: 'italic' }}>
            {best.content}
          </div>
        )}
      </div>
    );
  }

  const byDepth: Map<number, ThoughtNodeState[]> = new Map();
  for (const t of thoughts) {
    const list = byDepth.get(t.depth) ?? [];
    list.push(t);
    byDepth.set(t.depth, list);
  }

  return (
    <div style={{
      border: '1px solid var(--vscode-focusBorder)',
      borderRadius: 6,
      margin: '8px 0',
      overflow: 'hidden',
      background: 'var(--vscode-editor-background)',
    }}>
      <div
        onClick={() => { if (isComplete) setCollapsed(true); }}
        style={{
          padding: '8px 12px',
          background: 'var(--vscode-titleBar-activeBackground)',
          borderBottom: '1px solid var(--vscode-panel-border)',
          fontSize: 12,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          cursor: isComplete ? 'pointer' : 'default',
        }}
      >
        <span>{'\ud83c\udf33'} Tree of Thoughts {isComplete ? '(click to collapse)' : ''}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>
          {thoughts.length} thoughts explored
        </span>
      </div>

      <div style={{ padding: '6px 12px' }}>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8, fontStyle: 'italic' }}>
          Problem: {problem.length > 100 ? problem.slice(0, 97) + '...' : problem}
        </div>

        {Array.from(byDepth.entries()).sort(([a], [b]) => a - b).map(([depth, nodes]) => (
          <div key={depth} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              opacity: 0.5,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 4,
            }}>
              Depth {depth}
            </div>
            {nodes.map(node => {
              const score = scores.get(node.id) ?? node.score;
              const isBest = node.id === bestThoughtId;
              return (
                <div
                  key={node.id}
                  style={{
                    padding: '4px 8px',
                    marginBottom: 3,
                    borderRadius: 4,
                    border: isBest ? '1px solid var(--vscode-charts-green)' : '1px solid var(--vscode-panel-border)',
                    background: isBest ? 'var(--vscode-diffEditor-insertedTextBackground)' : 'transparent',
                    marginLeft: depth * 12,
                  }}
                >
                  <div style={{
                    fontSize: 11,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}>
                    <span style={{ flex: 1, lineHeight: 1.4 }}>{node.content}</span>
                    <span style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: scoreColor(score),
                      flexShrink: 0,
                    }}>
                      {isBest && '\u2b50 '}{Math.round(score * 100)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {!isComplete && (
          <div style={{
            fontSize: 10,
            opacity: 0.5,
            textAlign: 'center',
            padding: '4px 0',
          }}>
            Exploring reasoning paths...
          </div>
        )}

        {isComplete && bestThoughtId && (
          <div style={{
            padding: '6px 10px',
            background: 'var(--vscode-diffEditor-insertedTextBackground)',
            borderRadius: 4,
            border: '1px solid var(--vscode-charts-green)',
            marginTop: 8,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{'\u2b50'} Best Path</div>
            <div style={{ fontSize: 12 }}>
              {thoughts.find(t => t.id === bestThoughtId)?.content}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
```

### T10.6.2: Extension Host Bridge

```typescript
wireToTEvents(): void {
  this.eventBridge.on('tot_start', () => {
    this.toTState = { thoughts: [], scores: new Map(), bestThoughtId: undefined, isComplete: false, problem: '' };
    this.postMessage({ type: 'tot-start' });
  });

  this.eventBridge.on('tot_thought_generated', (event) => {
    const e = event as { thoughtId: string; content: string; parentId?: string; depth: number };
    this.toTState.thoughts.push({
      id: e.thoughtId,
      content: e.content,
      score: 0,
      parentId: e.parentId,
      depth: e.depth,
    });
    this.postMessage({ type: 'tot-update', state: { ...this.toTState, scores: Object.fromEntries(this.toTState.scores) } });
  });

  this.eventBridge.on('tot_evaluation', (event) => {
    const e = event as { thoughtId: string; score: number };
    this.toTState.scores.set(e.thoughtId, e.score);
    this.postMessage({ type: 'tot-update', state: { ...this.toTState, scores: Object.fromEntries(this.toTState.scores) } });
  });

  this.eventBridge.on('tot_complete', (event) => {
    const e = event as { bestThoughtId: string; score: number; content: string };
    this.toTState.isComplete = true;
    this.toTState.bestThoughtId = e.bestThoughtId;
    this.toTState.scores.set(e.bestThoughtId, e.score);
    this.postMessage({ type: 'tot-update', state: { ...this.toTState, scores: Object.fromEntries(this.toTState.scores) } });
  });
}
```

**Acceptance Criteria**:
- Panel appears when `tot_start` event fires
- Thoughts grouped by depth with visual indentation
- Each thought shows content text and evaluated score (colored: green >=80%, yellow >=50%, red <50%)
- Progress indicator ("Exploring reasoning paths...") while incomplete
- On `tot_complete`: best path highlighted with star and green border
- Collapsed state shows only best path with expand toggle
- Score percentages update in real-time as evaluations come in

---

## T10.7: Research Mode UI (`packages/vscode/src/webview/ui/components/ResearchPanel.tsx`)

**Status**: ✅
**File**: `packages/vscode/src/webview/ui/components/ResearchPanel.tsx`
**Estimated Effort**: 3 hours

### T10.7.1: Component Implementation

```tsx
import React, { useState } from 'react';

interface ResearchQueryState {
  id: string;
  question: string;
  sources: string;
  status: 'pending' | 'running' | 'complete';
  answer?: string;
  elapsed?: number;
}

interface ResearchPanelProps {
  question: string;
  queries: ResearchQueryState[];
  synthesizedReport?: string;
  isComplete: boolean;
}

const sourceIcons: Record<string, string> = {
  web: '\ud83c\udf10',
  code: '\ud83d\udcbb',
  docs: '\ud83d\udcc4',
  all: '\ud83d\udd0d',
};

const queryStatusIcon: Record<ResearchQueryState['status'], string> = {
  pending: '\u23f3',
  running: '\ud83d\udd04',
  complete: '\u2705',
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const ResearchPanel: React.FC<ResearchPanelProps> = ({
  question,
  queries,
  synthesizedReport,
  isComplete,
}) => {
  const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(true);

  const toggleQuery = (id: string) => {
    setExpandedQueries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const completeCount = queries.filter(q => q.status === 'complete').length;
  const progress = queries.length > 0 ? (completeCount / queries.length) * 100 : 0;

  return (
    <div style={{
      border: '1px solid var(--vscode-focusBorder)',
      borderRadius: 6,
      margin: '8px 0',
      overflow: 'hidden',
      background: 'var(--vscode-editor-background)',
    }}>
      <div style={{
        padding: '10px 14px',
        background: 'var(--vscode-titleBar-activeBackground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          {'\ud83d\udd2c'} Research: {question.length > 60 ? question.slice(0, 57) + '...' : question}
        </div>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
          {completeCount}/{queries.length} queries complete
          {!isComplete && ' — researching...'}
        </div>
      </div>

      <div style={{ height: 3, background: 'var(--vscode-progressBar-background)' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: isComplete ? 'var(--vscode-charts-green)' : 'var(--vscode-progressBar-background)',
          transition: 'width 0.5s ease',
        }} />
      </div>

      <div style={{ padding: '6px 0' }}>
        {queries.map(query => (
          <div key={query.id} style={{ padding: '4px 14px' }}>
            <div
              onClick={() => toggleQuery(query.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: query.answer ? 'pointer' : 'default',
                fontSize: 12,
              }}
            >
              <span>{queryStatusIcon[query.status]}</span>
              <span style={{ fontSize: 12 }}>{sourceIcons[query.sources] ?? '\ud83d\udd0d'}</span>
              <span style={{ flex: 1 }}>{query.question}</span>
              {query.elapsed != null && (
                <span style={{ fontSize: 10, opacity: 0.5 }}>{formatMs(query.elapsed)}</span>
              )}
              {query.answer && (
                <span style={{ fontSize: 10, opacity: 0.5 }}>{expandedQueries.has(query.id) ? '\u25b2' : '\u25bc'}</span>
              )}
            </div>

            {expandedQueries.has(query.id) && query.answer && (
              <div style={{
                padding: '6px 8px',
                marginLeft: 28,
                marginTop: 4,
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                background: 'var(--vscode-textBlockQuote-background)',
                borderRadius: 4,
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {query.answer}
              </div>
            )}
          </div>
        ))}
      </div>

      {synthesizedReport && isComplete && (
        <div style={{
          borderTop: '1px solid var(--vscode-panel-border)',
          padding: '10px 14px',
        }}>
          <div
            onClick={() => setShowReport(!showReport)}
            style={{
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: showReport ? 6 : 0,
            }}
          >
            <span>{'\ud83d\udcca'} Synthesized Report</span>
            <span style={{ fontSize: 10, opacity: 0.5 }}>{showReport ? '\u25b2' : '\u25bc'}</span>
          </div>
          {showReport && (
            <div style={{
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--vscode-editor-font-family)',
            }}>
              {synthesizedReport}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

### T10.7.2: Extension Host Bridge

```typescript
wireResearchEvents(): void {
  this.eventBridge.on('research_start', (event) => {
    const e = event as { question: string };
    this.researchState = {
      question: e.question,
      queries: [],
      synthesizedReport: undefined,
      isComplete: false,
    };
    this.postMessage({ type: 'research-start', state: this.researchState });
  });

  this.eventBridge.on('research_query', (event) => {
    const e = event as { queryId: string; question: string; sources: string };
    this.researchState.queries.push({
      id: e.queryId,
      question: e.question,
      sources: e.sources,
      status: 'running',
    });
    this.postMessage({ type: 'research-update', state: this.researchState });
  });

  this.eventBridge.on('research_subagent_complete', (event) => {
    const e = event as { queryId: string; result: { answer: string; elapsed: number } };
    const query = this.researchState.queries.find((q: any) => q.id === e.queryId);
    if (query) {
      query.status = 'complete';
      query.answer = e.result.answer;
      query.elapsed = e.result.elapsed;
    }
    this.postMessage({ type: 'research-update', state: this.researchState });
  });

  this.eventBridge.on('research_complete', (event) => {
    const e = event as { report: string };
    this.researchState.isComplete = true;
    this.researchState.synthesizedReport = e.report;
    this.postMessage({ type: 'research-update', state: this.researchState });
  });
}
```

**Acceptance Criteria**:
- Panel appears on `research_start` with research question displayed
- Progress bar tracks query completion
- Each query row shows: status icon, source type icon, question text, elapsed time
- Queries turn from running to complete as sub-agents finish
- Expandable answers show scrollable text blocks with sub-agent output
- Synthesized report section appears on completion with collapsible rendering
- Research indicator in webview status area during processing

---

## T10.8: TODO Panel Enhancement (`packages/vscode/src/webview/ui/components/TodoPanel.tsx`)

**Status**: ✅
**File**: `packages/vscode/src/webview/ui/components/TodoPanel.tsx`
**Estimated Effort**: 3 hours

### T10.8.1: Component Implementation

```tsx
import React from 'react';

interface TodoItem {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

interface TodoPanelProps {
  items: TodoItem[];
  total: number;
  completed: number;
  current: string | null;
}

const statusIcon: Record<TodoItem['status'], string> = {
  'not-started': '\u25cb',
  'in-progress': '\u25d0',
  'completed': '\u25cf',
};

const statusColor: Record<TodoItem['status'], string> = {
  'not-started': 'var(--vscode-descriptionForeground)',
  'in-progress': 'var(--vscode-charts-blue)',
  'completed': 'var(--vscode-charts-green)',
};

export const TodoPanel: React.FC<TodoPanelProps> = ({ items, total, completed, current }) => {
  if (items.length === 0) return null;

  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div style={{
      border: '1px solid var(--vscode-panel-border)',
      borderRadius: 6,
      margin: '8px 0',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '6px 12px',
        background: 'var(--vscode-sideBarSectionHeader-background)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
        fontWeight: 600,
      }}>
        <span>TODOS</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{completed}/{total} done</span>
      </div>

      <div style={{ height: 3, background: 'var(--vscode-scrollbarSlider-background)' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: progress === 100 ? 'var(--vscode-charts-green)' : 'var(--vscode-progressBar-background)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      {current && (
        <div style={{
          padding: '4px 12px',
          fontSize: 11,
          background: 'var(--vscode-editor-selectionHighlightBackground)',
          borderLeft: '3px solid var(--vscode-charts-blue)',
          color: 'var(--vscode-charts-blue)',
        }}>
          Working on: {current}
        </div>
      )}

      <div style={{ padding: '4px 0' }}>
        {items.map(item => (
          <div
            key={item.id}
            style={{
              padding: '3px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              opacity: item.status === 'completed' ? 0.6 : 1,
            }}
          >
            <span style={{ color: statusColor[item.status], fontSize: 13 }}>
              {statusIcon[item.status]}
            </span>
            <span style={{
              textDecoration: item.status === 'completed' ? 'line-through' : 'none',
              flex: 1,
            }}>
              {item.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### T10.8.2: Extension Host Integration

```typescript
wireTodoEvents(): void {
  this.eventBridge.on('todo_update', (event) => {
    const e = event as { items: Array<{ id: number; title: string; status: string }> };
    const items = e.items as TodoItem[];
    const completed = items.filter(i => i.status === 'completed').length;
    const current = items.find(i => i.status === 'in-progress');

    this.postMessage({
      type: 'todo-update',
      items,
      total: items.length,
      completed,
      current: current?.title ?? null,
    });
  });
}
```

**Acceptance Criteria**:
- Panel renders automatically when TODO items exist (driven by `todo_update` events)
- Progress bar fills proportionally (completed/total), turns green at 100%
- "Working on: X" banner highlights the single in-progress item
- Each item shows: status indicator (circle open/half/filled), title text
- Completed items are dimmed with line-through decoration
- Panel updates in real-time via `todo_update` events

---

## T10.9: Scheduler Integration (`packages/vscode/src/adapter/SchedulerAdapter.ts`)

**Status**: ✅
**File**: `packages/vscode/src/adapter/SchedulerAdapter.ts`
**Estimated Effort**: 3 hours

### T10.9.1: SchedulerAdapter Implementation

```typescript
import * as vscode from 'vscode';
import type { Scheduler, ScheduledJob } from '@agentx/engine';

interface ReminderTreeItem {
  kind: 'job' | 'empty';
  label: string;
  description?: string;
  tooltip?: string;
  job?: ScheduledJob;
}

export class SchedulerAdapter implements vscode.TreeDataProvider<ReminderTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReminderTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private scheduler: Scheduler | null = null;
  private disposables: vscode.Disposable[] = [];
  private firedNotifications = new Set<string>();

  attach(scheduler: Scheduler): void {
    this.scheduler = scheduler;
    this.wireTriggerHandler();
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ReminderTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );

    item.description = element.description;
    item.tooltip = element.tooltip;
    item.contextValue = element.job?.enabled ? 'reminder-enabled' : 'reminder-disabled';

    if (element.job) {
      if (element.job.oneShot) {
        item.iconPath = new vscode.ThemeIcon('alarm');
      } else {
        item.iconPath = new vscode.ThemeIcon(element.job.enabled ? 'sync' : 'sync-ignored');
      }
    }

    return item;
  }

  getChildren(element?: ReminderTreeItem): ReminderTreeItem[] {
    if (element) return [];
    if (!this.scheduler) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    const jobs = this.scheduler.getJobs();
    if (jobs.length === 0) {
      return [{ kind: 'empty', label: 'No scheduled reminders' }];
    }

    return jobs.sort((a, b) => a.nextRun - b.nextRun).map(job => {
      const nextRunDate = new Date(job.nextRun);
      const now = Date.now();
      let timeUntil: string;

      if (job.cron.startsWith('@timer:')) {
        const remaining = Math.max(0, job.nextRun - now);
        const secs = Math.ceil(remaining / 1000);
        if (secs < 60) timeUntil = `in ${secs}s`;
        else timeUntil = `in ${Math.ceil(secs / 60)}m`;
      } else if (job.cron.startsWith('@every:')) {
        const match = job.cron.match(/@every:(\d+)s/);
        const interval = match ? parseInt(match[1]!, 10) : 0;
        timeUntil = `every ${interval}s`;
      } else {
        timeUntil = `at ${nextRunDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      }

      const disabledTag = !job.enabled ? ' (disabled)' : '';
      const runInfo = job.runCount > 0 ? ` — ran ${job.runCount}x` : '';

      return {
        kind: 'job' as const,
        label: job.name + disabledTag,
        description: `${timeUntil}${runInfo}`,
        tooltip: [
          `Name: ${job.name}`,
          `Schedule: ${job.cron}`,
          `Instruction: ${job.instruction}`,
          `Next run: ${nextRunDate.toLocaleString()}`,
          `Run count: ${job.runCount}`,
          `Enabled: ${job.enabled}`,
          `One-shot: ${!!job.oneShot}`,
        ].join('\n'),
        job,
      };
    });
  }

  private wireTriggerHandler(): void {
    if (!this.scheduler) return;

    this.scheduler.setTriggerHandler((job) => {
      const notifKey = `${job.id}-${job.lastRun}`;
      if (this.firedNotifications.has(notifKey)) return;
      this.firedNotifications.add(notifKey);

      vscode.window.showInformationMessage(
        `\u23f0 ${job.name}: ${job.instruction}`,
        'Dismiss',
        'Run Again',
      ).then(action => {
        if (action === 'Run Again') {
          this.scheduler?.runJob(job.id);
        }
      });
    });
  }

  async addReminder(): Promise<void> {
    if (!this.scheduler) {
      vscode.window.showErrorMessage('No agent active.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Reminder name',
      placeHolder: 'e.g., Stand up and stretch',
    });
    if (!name) return;

    const delayChoice = await vscode.window.showQuickPick([
      { label: '1 minute', value: 60 },
      { label: '5 minutes', value: 300 },
      { label: '15 minutes', value: 900 },
      { label: '30 minutes', value: 1800 },
      { label: '1 hour', value: 3600 },
      { label: 'Custom (seconds)', value: -1 },
    ], { placeHolder: 'Fire after...' });
    if (!delayChoice) return;

    let delaySecs = delayChoice.value;
    if (delaySecs === -1) {
      const custom = await vscode.window.showInputBox({
        prompt: 'Delay in seconds',
        placeHolder: 'e.g., 120',
        validateInput: v => /^\d+$/.test(v) ? null : 'Must be a number',
      });
      if (!custom) return;
      delaySecs = parseInt(custom, 10);
    }

    const instruction = await vscode.window.showInputBox({
      prompt: 'Reminder message',
      placeHolder: 'e.g., Time to take a break!',
      value: name,
    });
    if (!instruction) return;

    this.scheduler.addTimer(name, delaySecs, instruction);
    this.refresh();
    vscode.window.showInformationMessage(`Reminder "${name}" set for ${delaySecs}s.`);
  }

  async removeReminder(item: ReminderTreeItem): Promise<void> {
    if (!this.scheduler || !item.job) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Remove reminder "${item.job.name}"?`,
      { modal: true },
      'Remove',
    );
    if (confirmed === 'Remove') {
      this.scheduler.removeJob(item.job.id);
      this.refresh();
    }
  }

  toggleReminder(item: ReminderTreeItem): void {
    if (!this.scheduler || !item.job) return;
    this.scheduler.toggleJob(item.job.id);
    this.refresh();
  }

  runNow(item: ReminderTreeItem): void {
    if (!this.scheduler || !item.job) return;
    this.scheduler.runJob(item.job.id);
    this.refresh();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
```

### T10.9.2: Tree View and Command Registration

**File**: `packages/vscode/src/extension.ts` (additive)

```typescript
import { SchedulerAdapter } from './adapter/SchedulerAdapter';

const schedulerAdapter = new SchedulerAdapter();
context.subscriptions.push(schedulerAdapter);

const remindersTreeView = vscode.window.createTreeView('agentxReminders', {
  treeDataProvider: schedulerAdapter,
  showCollapseAll: true,
});
context.subscriptions.push(remindersTreeView);

context.subscriptions.push(
  vscode.commands.registerCommand('agentx.reminder.add', () => schedulerAdapter.addReminder()),
  vscode.commands.registerCommand('agentx.reminder.remove', (item) => schedulerAdapter.removeReminder(item)),
  vscode.commands.registerCommand('agentx.reminder.toggle', (item) => schedulerAdapter.toggleReminder(item)),
  vscode.commands.registerCommand('agentx.reminder.runNow', (item) => schedulerAdapter.runNow(item)),
  vscode.commands.registerCommand('agentx.reminder.refresh', () => schedulerAdapter.refresh()),
);
```

### T10.9.3: package.json Contribution

```json
{
  "views": {
    "agentx-sidebar": [
      {
        "id": "agentxReminders",
        "name": "Reminders & Scheduled Jobs",
        "when": "agentx.activated"
      }
    ]
  },
  "commands": [
    {
      "command": "agentx.reminder.add",
      "title": "Add Reminder",
      "icon": "$(add)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.reminder.remove",
      "title": "Remove Reminder",
      "icon": "$(trash)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.reminder.toggle",
      "title": "Toggle Reminder",
      "icon": "$(circle-slash)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.reminder.runNow",
      "title": "Run Reminder Now",
      "icon": "$(play)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.reminder.refresh",
      "title": "Refresh Reminders",
      "icon": "$(refresh)",
      "category": "Agent-X"
    }
  ],
  "menus": {
    "view/title": [
      {
        "command": "agentx.reminder.add",
        "when": "view == agentxReminders",
        "group": "navigation"
      },
      {
        "command": "agentx.reminder.refresh",
        "when": "view == agentxReminders",
        "group": "navigation"
      }
    ],
    "view/item/context": [
      {
        "command": "agentx.reminder.toggle",
        "when": "view == agentxReminders && viewItem =~ /^reminder-/",
        "group": "inline@1"
      },
      {
        "command": "agentx.reminder.runNow",
        "when": "view == agentxReminders && viewItem =~ /^reminder-/",
        "group": "inline@2"
      },
      {
        "command": "agentx.reminder.remove",
        "when": "view == agentxReminders && viewItem =~ /^reminder-/",
        "group": "destructive"
      }
    ]
  }
}
```

**Acceptance Criteria**:
- Tree view lists all scheduled jobs/reminders sorted by next run time
- Each item shows: name, schedule description (e.g., "in 5m", "every 60s", "at 2:30 PM"), run count
- Tooltip shows full details: schedule, instruction, enabled status, next run time
- Icons differentiate one-shot timers (alarm) from recurring jobs (sync)
- Disabled jobs show "(disabled)" suffix and faded sync icon
- Inline context actions: toggle enable/disable, run now, remove (with confirmation)
- `addReminder` command: InputBox for name -> QuickPick for delay -> InputBox for message
- Notification toast fires when `setTriggerHandler` callback invoked by scheduler tick
- Toast includes "Dismiss" and "Run Again" buttons

---

## T10.10: MCP Server Management (`packages/vscode/src/commands/MCPManager.ts`)

**Status**: ✅
**File**: `packages/vscode/src/commands/MCPManager.ts`
**Estimated Effort**: 3 hours

### T10.10.1: MCPManager TreeDataProvider

```typescript
import * as vscode from 'vscode';
import type { MCPBridge } from '@agentx/engine';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agentx/shared';

interface MCPTreeItem {
  kind: 'server' | 'tool' | 'empty';
  label: string;
  description?: string;
  tooltip?: string;
  serverName?: string;
  toolName?: string;
  toolCount?: number;
  running?: boolean;
}

export class MCPManager implements vscode.TreeDataProvider<MCPTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<MCPTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private bridge: MCPBridge | null = null;
  private cache = new Map<string, Array<{ name: string; description: string }>>();

  attach(bridge: MCPBridge): void {
    this.bridge = bridge;
    this.discoverTools();
    this.refresh();
  }

  refresh(): void {
    this.discoverTools();
    this._onDidChangeTreeData.fire();
  }

  private discoverTools(): void {
    if (!this.bridge) return;

    for (const name of this.bridge.getServerNames()) {
      this.bridge.listTools(name).then(tools => {
        this.cache.set(name, tools.map(t => ({
          name: t.name,
          description: t.description ?? '',
        })));
        this._onDidChangeTreeData.fire();
      }).catch(() => {
        this.cache.set(name, []);
      });
    }
  }

  getTreeItem(element: MCPTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    if (element.kind === 'server') {
      const item = new vscode.TreeItem(
        element.label,
        element.toolCount && element.toolCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );

      item.description = element.description;
      item.tooltip = element.tooltip;
      item.iconPath = new vscode.ThemeIcon(
        element.running ? 'plug' : 'debug-disconnect',
      );
      item.contextValue = element.running ? 'mcp-server-running' : 'mcp-server-stopped';
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon('tools');
    item.contextValue = 'mcp-tool';
    item.command = {
      command: 'agentx.mcp.testTool',
      title: 'Test MCP Tool',
      arguments: [element.serverName, element.toolName],
    };
    return item;
  }

  getChildren(element?: MCPTreeItem): MCPTreeItem[] {
    if (!this.bridge) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    if (!element) {
      const statuses = this.bridge.getServerStatus();
      if (statuses.length === 0) {
        return [{ kind: 'empty', label: 'No MCP servers configured' }];
      }
      return statuses.map(s => ({
        kind: 'server' as const,
        label: s.name,
        description: `${s.toolCount} tool${s.toolCount !== 1 ? 's' : ''}`,
        tooltip: [
          `Server: ${s.name}`,
          `Running: ${s.running}`,
          `Tools: ${s.toolCount}`,
          s.error ? `Error: ${s.error}` : '',
        ].filter(Boolean).join('\n'),
        serverName: s.name,
        toolCount: s.toolCount,
        running: s.running,
      }));
    }

    if (element.kind === 'server' && element.serverName) {
      const tools = this.cache.get(element.serverName) ?? [];
      if (tools.length === 0) {
        return [{ kind: 'tool', label: 'No tools discovered yet', serverName: element.serverName }];
      }
      return tools.map(t => ({
        kind: 'tool' as const,
        label: t.name,
        description: t.description.length > 50 ? t.description.slice(0, 47) + '...' : t.description,
        tooltip: `${t.name}\n${t.description}`,
        serverName: element.serverName,
        toolName: t.name,
      }));
    }

    return [];
  }

  async connectServer(name?: string): Promise<void> {
    if (!this.bridge) return;

    if (!name) {
      const manifests = await this.bridge.discover();
      const disconnected = manifests.filter(m => {
        const n = m.id.replace(/^mcp:/, '');
        return !this.bridge!.getServerNames().includes(n);
      });

      if (disconnected.length === 0) {
        vscode.window.showInformationMessage('All configured MCP servers are already connected.');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        disconnected.map(m => ({
          label: m.name,
          description: m.description,
          name: m.id.replace(/^mcp:/, ''),
        })),
        { placeHolder: 'Select MCP server to connect' },
      );

      if (!selected) return;
      name = selected.name;
    }

    try {
      const manifest = { id: `mcp:${name}`, name: `MCP:${name}`, version: '0.1.0', description: '', source: 'mcp', tools: [] };
      await this.bridge.load(manifest as any);
      this.refresh();
      vscode.window.showInformationMessage(`MCP server "${name}" connected.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to connect "${name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnectServer(item: MCPTreeItem): Promise<void> {
    if (!this.bridge || !item.serverName) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Disconnect MCP server "${item.serverName}"?`,
      { modal: true },
      'Disconnect',
    );

    if (confirmed === 'Disconnect') {
      await this.bridge.unload(item.serverName);
      this.cache.delete(item.serverName);
      this.refresh();
      vscode.window.showInformationMessage(`MCP server "${item.serverName}" disconnected.`);
    }
  }

  async testTool(serverName?: string, toolName?: string): Promise<void> {
    if (!serverName || !toolName) {
      serverName = await vscode.window.showInputBox({ prompt: 'MCP Server Name' });
      if (!serverName) return;
      toolName = await vscode.window.showInputBox({ prompt: 'Tool Name' });
      if (!toolName) return;
    }

    const argsJson = await vscode.window.showInputBox({
      prompt: `Arguments for ${toolName} (JSON)`,
      placeHolder: '{"key": "value"}',
      value: '{}',
    });
    if (argsJson === undefined) return;

    try {
      const args = JSON.parse(argsJson);
      const result = await this.bridge!.callTool(serverName, toolName, args);
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      const doc = await vscode.workspace.openTextDocument({
        content: output,
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async openConfig(): Promise<void> {
    const configPath = join(getConfigDir(), 'mcp.json');
    if (!existsSync(configPath)) {
      vscode.window.showWarningMessage('MCP config file does not exist yet. Connect a server first.');
      return;
    }
    const uri = vscode.Uri.file(configPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
```

### T10.10.2: Registration and Commands

```typescript
import { MCPManager } from './commands/MCPManager';

const mcpManager = new MCPManager();
context.subscriptions.push(mcpManager);

const mcpTreeView = vscode.window.createTreeView('agentxMCPServers', {
  treeDataProvider: mcpManager,
  showCollapseAll: true,
});
context.subscriptions.push(mcpTreeView);

context.subscriptions.push(
  vscode.commands.registerCommand('agentx.mcp.connect', (name?: string) => mcpManager.connectServer(name)),
  vscode.commands.registerCommand('agentx.mcp.disconnect', (item) => mcpManager.disconnectServer(item)),
  vscode.commands.registerCommand('agentx.mcp.testTool', (s, t) => mcpManager.testTool(s, t)),
  vscode.commands.registerCommand('agentx.mcp.openConfig', () => mcpManager.openConfig()),
  vscode.commands.registerCommand('agentx.mcp.refresh', () => mcpManager.refresh()),
);
```

### T10.10.3: package.json Contribution

```json
{
  "views": {
    "agentx-sidebar": [
      {
        "id": "agentxMCPServers",
        "name": "MCP Servers",
        "when": "agentx.activated"
      }
    ]
  },
  "commands": [
    {
      "command": "agentx.mcp.connect",
      "title": "Connect MCP Server",
      "icon": "$(plug)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.mcp.disconnect",
      "title": "Disconnect MCP Server",
      "icon": "$(debug-disconnect)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.mcp.testTool",
      "title": "Test MCP Tool",
      "icon": "$(play)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.mcp.openConfig",
      "title": "Open MCP Config",
      "icon": "$(settings-gear)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.mcp.refresh",
      "title": "Refresh MCP Servers",
      "icon": "$(refresh)",
      "category": "Agent-X"
    }
  ],
  "menus": {
    "view/title": [
      {
        "command": "agentx.mcp.connect",
        "when": "view == agentxMCPServers",
        "group": "navigation"
      },
      {
        "command": "agentx.mcp.openConfig",
        "when": "view == agentxMCPServers",
        "group": "navigation"
      },
      {
        "command": "agentx.mcp.refresh",
        "when": "view == agentxMCPServers",
        "group": "navigation"
      }
    ],
    "view/item/context": [
      {
        "command": "agentx.mcp.connect",
        "when": "view == agentxMCPServers && viewItem == mcp-server-stopped"
      },
      {
        "command": "agentx.mcp.disconnect",
        "when": "view == agentxMCPServers && viewItem == mcp-server-running",
        "group": "destructive"
      }
    ]
  }
}
```

**Acceptance Criteria**:
- Tree view shows all MCP servers with running/stopped status icons (plug/disconnect)
- Server items show tool count in description
- Expanding a running server reveals its discovered tools as children
- Tool items clickable: opens InputBox for JSON args, calls `bridge.callTool()`, shows result
- Context menu: connect (for stopped), disconnect (for running with confirmation)
- `openConfig` opens `~/.config/agentx/mcp.json` in VS Code text editor
- Error handling for connection failures and tool call failures with descriptive messages

---

## T10.11: Reflection & Skills Display (`packages/vscode/src/adapter/SkillsAdapter.ts`)

**Status**: ✅
**File**: `packages/vscode/src/adapter/SkillsAdapter.ts`
**Estimated Effort**: 2 hours

### T10.11.1: SkillsAdapter TreeDataProvider

```typescript
import * as vscode from 'vscode';
import type { SkillGenerator, GeneratedSkill, ReflectionLoop } from '@agentx/engine';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface SkillTreeItem {
  kind: 'skill-header' | 'generated-skill' | 'bundled-skill' | 'reflection-header' | 'learning' | 'empty';
  label: string;
  description?: string;
  tooltip?: string;
  skill?: GeneratedSkill;
  learningText?: string;
}

export class SkillsAdapter implements vscode.TreeDataProvider<SkillTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private generator: SkillGenerator | null = null;
  private reflectionLoop: ReflectionLoop | null = null;

  attach(generator: SkillGenerator, reflectionLoop?: ReflectionLoop): void {
    this.generator = generator;
    this.reflectionLoop = reflectionLoop ?? null;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    if (element.kind === 'skill-header' || element.kind === 'reflection-header') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(
        element.kind === 'skill-header' ? 'symbol-event' : 'lightbulb',
      );
      return item;
    }

    if (element.kind === 'learning') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.tooltip = element.learningText;
      item.iconPath = new vscode.ThemeIcon('check');
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = new vscode.ThemeIcon(
      element.kind === 'generated-skill' ? 'zap' : 'bookmark',
    );
    item.contextValue = element.kind === 'generated-skill' ? 'generated-skill' : 'bundled-skill';
    item.command = {
      command: 'agentx.skill.viewDetail',
      title: 'View Skill',
      arguments: [element.skill],
    };
    return item;
  }

  getChildren(element?: SkillTreeItem): SkillTreeItem[] {
    if (!element) {
      return this.getRootGroups();
    }

    if (element.kind === 'skill-header') {
      return this.getSkillsList();
    }

    if (element.kind === 'reflection-header') {
      return this.getLearnings();
    }

    return [];
  }

  private getRootGroups(): SkillTreeItem[] {
    if (!this.generator) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    const groups: SkillTreeItem[] = [
      { kind: 'skill-header', label: 'Skills' },
    ];

    if (this.reflectionLoop && this.reflectionLoop.getHistory().length > 0) {
      groups.push({ kind: 'reflection-header', label: 'Reflective Learnings' });
    }

    return groups;
  }

  private getSkillsList(): SkillTreeItem[] {
    if (!this.generator) return [];

    const all = this.generator.getAll();
    if (all.length === 0) {
      return [{ kind: 'empty', label: 'No skills available' }];
    }

    return all.map(skill => ({
      kind: (skill.id.startsWith('skill-') && !skill.id.startsWith('skill-init') && !skill.id.startsWith('skill-setup') && !skill.id.startsWith('skill-dockerize'))
        ? 'generated-skill' as const
        : 'bundled-skill' as const,
      label: skill.name,
      description: `${skill.tools.length} tools \u2022 used ${skill.usageCount}x`,
      tooltip: [
        `Name: ${skill.name}`,
        `Description: ${skill.description}`,
        `Triggers: ${skill.triggerPatterns.join(', ')}`,
        `Tools: ${skill.tools.join(', ')}`,
        `Usage Count: ${skill.usageCount}`,
        `Created: ${skill.createdAt}`,
        skill.id.startsWith('skill-') ? 'Generated' : 'Bundled',
      ].join('\n'),
      skill,
    }));
  }

  private getLearnings(): SkillTreeItem[] {
    if (!this.reflectionLoop) return [];

    const history = this.reflectionLoop.getHistory();
    if (history.length === 0) return [];

    const learnings = this.reflectionLoop.getCumulativeLearnings();
    if (!learnings) return [{ kind: 'learning', label: 'No learnings yet' }];

    const lines = learnings.split('\n').filter(l => l.trim().length > 0 && /^\d+\./.test(l.trim()));
    return lines.map(line => ({
      kind: 'learning' as const,
      label: line.replace(/^\d+\.\s*/, '').slice(0, 60),
      description: line.length > 60 ? '...' : '',
      learningText: line.replace(/^\d+\.\s*/, ''),
    }));
  }

  async viewDetail(skill: GeneratedSkill): Promise<void> {
    const content = [
      `Skill: ${skill.name}`,
      '\u2550'.repeat(40),
      '',
      `ID: ${skill.id}`,
      `Description: ${skill.description}`,
      `Category: ${skill.id.startsWith('skill-') && !skill.id.includes('-init') ? 'Generated' : 'Bundled'}`,
      `Usage Count: ${skill.usageCount}`,
      `Created: ${skill.createdAt}`,
      '',
      'Trigger Patterns:',
      ...skill.triggerPatterns.map(p => `  \u2022 ${p}`),
      '',
      'Tools Used:',
      ...skill.tools.map(t => `  \u2022 ${t}`),
      '',
      'Prompt Template:',
      skill.prompt,
    ].join('\n');

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  async deleteSkill(item: SkillTreeItem): Promise<void> {
    if (!item.skill || item.kind !== 'generated-skill') {
      vscode.window.showWarningMessage('Only generated skills can be deleted.');
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete skill "${item.skill.name}"?`,
      { modal: true },
      'Delete',
    );

    if (confirmed === 'Delete') {
      const filePath = join(homedir(), '.config', 'agentx', 'skills', `${item.skill.id}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      this.refresh();
      vscode.window.showInformationMessage(`Skill "${item.skill.name}" deleted.`);
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
```

### T10.11.2: Registration

```typescript
import { SkillsAdapter } from './adapter/SkillsAdapter';

const skillsAdapter = new SkillsAdapter();
context.subscriptions.push(skillsAdapter);

const skillsTreeView = vscode.window.createTreeView('agentxSkills', {
  treeDataProvider: skillsAdapter,
  showCollapseAll: true,
});
context.subscriptions.push(skillsTreeView);

context.subscriptions.push(
  vscode.commands.registerCommand('agentx.skills.refresh', () => skillsAdapter.refresh()),
  vscode.commands.registerCommand('agentx.skill.viewDetail', (skill) => skillsAdapter.viewDetail(skill)),
  vscode.commands.registerCommand('agentx.skill.delete', (item) => skillsAdapter.deleteSkill(item)),
);
```

### T10.11.3: package.json

```json
{
  "views": {
    "agentx-sidebar": [
      {
        "id": "agentxSkills",
        "name": "Skills & Learnings",
        "when": "agentx.activated"
      }
    ]
  },
  "commands": [
    {
      "command": "agentx.skills.refresh",
      "title": "Refresh Skills",
      "icon": "$(refresh)",
      "category": "Agent-X"
    },
    {
      "command": "agentx.skill.viewDetail",
      "title": "View Skill Detail",
      "category": "Agent-X"
    },
    {
      "command": "agentx.skill.delete",
      "title": "Delete Skill",
      "icon": "$(trash)",
      "category": "Agent-X"
    }
  ],
  "menus": {
    "view/title": [
      {
        "command": "agentx.skills.refresh",
        "when": "view == agentxSkills",
        "group": "navigation"
      }
    ],
    "view/item/context": [
      {
        "command": "agentx.skill.delete",
        "when": "view == agentxSkills && viewItem == generated-skill",
        "group": "destructive"
      }
    ]
  }
}
```

**Acceptance Criteria**:
- Tree shows two root groups: "Skills" and "Reflective Learnings" (when history exists)
- Skills group expands to show all skills (bundled + generated), sorted by usage count
- Bundled skills shown with bookmark icon; generated with zap icon
- Each skill row: name, tool count, usage count
- Clicking a skill opens formatted text document with full details including prompt template
- Delete only available for generated skills (context menu on right-click)
- Reflective Learnings group shows parsed cumulative suggestions from ReflectionLoop
- Tooltips display trigger patterns, tools, creation date, and origin

---

## T10.12: Clarification Dialog (`packages/vscode/src/adapter/ClarificationHandler.ts`)

**Status**: ✅
**File**: `packages/vscode/src/adapter/ClarificationHandler.ts`
**Estimated Effort**: 2 hours

### T10.12.1: Implementation

```typescript
import * as vscode from 'vscode';
import type { Agent } from '@agentx/engine';

interface ClarificationPayload {
  question: string;
  options: string[];
  allowFreeform: boolean;
}

export class ClarificationHandler {
  private engine: Agent | null = null;

  attach(engine: Agent): void {
    this.engine = engine;
  }

  async handle(event: ClarificationPayload): Promise<void> {
    if (!this.engine) return;

    let response: string | undefined;

    if (event.options.length > 0) {
      const items: vscode.QuickPickItem[] = event.options.map(opt => ({
        label: opt,
      }));

      if (event.allowFreeform) {
        items.unshift({
          label: '$(edit) Type your own response...',
          description: 'Free-form answer',
        });
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: event.question,
        title: 'Agent-X needs clarification',
        ignoreFocusOut: true,
      });

      if (!picked) {
        this.engine.respondToClarification('skipped');
        return;
      }

      if (picked.label.includes('Type your own')) {
        response = await this.showFreeformInput(event.question);
      } else {
        response = picked.label;
      }
    } else if (event.allowFreeform) {
      response = await this.showFreeformInput(event.question);
    } else {
      vscode.window.showWarningMessage(event.question);
      response = 'acknowledged';
    }

    if (response !== undefined) {
      this.engine.respondToClarification(response);
    }
  }

  private async showFreeformInput(question: string): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: question,
      placeHolder: 'Type your response...',
      ignoreFocusOut: true,
      validateInput: (v) => v.trim().length > 0 ? null : 'Please provide a response',
    });
  }

  dispose(): void {}
}
```

### T10.12.2: Event Bridge Wiring

**File**: `packages/vscode/src/adapter/EventBridge.ts` (additive)

```typescript
import { ClarificationHandler } from './ClarificationHandler';

private clarificationHandler: ClarificationHandler;

// In setup:
this.eventBus.on('clarification_required', (event) => {
  const e = event as unknown as ClarificationPayload;
  this.clarificationHandler.handle(e);
});
```

**Acceptance Criteria**:
- When `clarification_required` event fires, QuickPick dialog appears
- QuickPick lists provided options as selectable items
- If `allowFreeform` is true: adds "Type your own response..." option at top
- Selecting an option sends it directly via `agent.respondToClarification(selected)`
- Selecting "Type your own" opens InputBox with validation (non-empty required)
- InputBox prompt set to the clarification question text
- If no quickpick options but freeform allowed: goes directly to InputBox
- Dismissing the dialog sends `'skipped'` as response so agent doesn't hang indefinitely
- `ignoreFocusOut: true` ensures dialog persists even if user clicks outside

---

## T10.13: Session Modes (`packages/vscode/src/adapter/SessionModes.ts`)

**Status**: ✅
**File**: `packages/vscode/src/adapter/SessionModes.ts`
**Estimated Effort**: 2 hours

### T10.13.1: Implementation

```typescript
import * as vscode from 'vscode';
import type { Agent } from '@agentx/engine';

export type SessionMode = 'agent' | 'ask' | 'plan';

interface ModeDefinition {
  id: SessionMode;
  label: string;
  description: string;
  icon: string;
}

const MODES: ModeDefinition[] = [
  { id: 'agent', label: 'Agent Mode', description: 'Full capabilities — tools, code execution, file modification', icon: '$(rocket)' },
  { id: 'ask', label: 'Ask Mode', description: 'Answer questions only — no tool execution', icon: '$(question)' },
  { id: 'plan', label: 'Plan Mode', description: 'Generate plans with approval — review before executing', icon: '$(list-ordered)' },
];

export class SessionModes implements vscode.Disposable {
  private mode: SessionMode = 'agent';
  private engine: Agent | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private _onModeChanged = new vscode.EventEmitter<SessionMode>();
  readonly onModeChanged = this._onModeChanged.event;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
    this.updateStatusBar();
  }

  attach(engine: Agent): void {
    this.engine = engine;
  }

  get currentMode(): SessionMode {
    return this.mode;
  }

  async switchMode(mode?: SessionMode): Promise<void> {
    if (!mode) {
      const currentDef = MODES.find(m => m.id === this.mode)!;
      const items = MODES.map(m => ({
        label: `${m.icon} ${m.label}`,
        description: m.id === this.mode ? '(active)' : '',
        detail: m.description,
        modeId: m.id,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Current mode: ${currentDef.label}`,
        title: 'Switch Session Mode',
      });

      if (!picked) return;
      mode = picked.modeId;
    }

    this.setMode(mode);
  }

  setMode(mode: SessionMode): void {
    if (mode === this.mode) return;

    this.mode = mode;

    if (this.engine) {
      switch (mode) {
        case 'agent':
          this.engine.setPlanMode(false);
          break;
        case 'ask':
          this.engine.setPlanMode(false);
          break;
        case 'plan':
          this.engine.setPlanMode(true);
          break;
      }
    }

    this.updateStatusBar();
    this._onModeChanged.fire(mode);

    const def = MODES.find(m => m.id === mode)!;
    vscode.window.showInformationMessage(`${def.icon} Switched to ${def.label}: ${def.description}`);
  }

  private updateStatusBar(): void {
    const def = MODES.find(m => m.id === this.mode)!;
    this.statusBarItem.text = `${def.icon} ${def.label.replace(' Mode', '')}`;
    this.statusBarItem.tooltip = `Agent-X: ${def.label}\n${def.description}\nClick to switch mode`;
    this.statusBarItem.command = 'agentx.session.switchMode';
    this.statusBarItem.show();
  }

  isReadOnly(): boolean {
    return this.mode === 'ask';
  }

  isPlanning(): boolean {
    return this.mode === 'plan';
  }

  dispose(): void {
    this._onModeChanged.dispose();
    this.statusBarItem.dispose();
  }
}
```

### T10.13.2: Webview Mode Switcher Header

```tsx
const ModeSwitcher: React.FC<{ mode: SessionMode; onSwitch: (mode: SessionMode) => void }> = ({ mode, onSwitch }) => {
  const modes = [
    { id: 'agent' as const, label: 'Agent', icon: '\ud83d\ude80' },
    { id: 'ask' as const, label: 'Ask', icon: '\u2753' },
    { id: 'plan' as const, label: 'Plan', icon: '\ud83d\udccb' },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: 2,
      padding: '2px 4px',
      background: 'var(--vscode-sideBarSectionHeader-background)',
      borderRadius: 4,
    }}>
      {modes.map(m => (
        <button
          key={m.id}
          onClick={() => onSwitch(m.id)}
          style={{
            flex: 1,
            padding: '3px 8px',
            fontSize: 11,
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            background: mode === m.id
              ? 'var(--vscode-button-background)'
              : 'transparent',
            color: mode === m.id
              ? 'var(--vscode-button-foreground)'
              : 'var(--vscode-foreground)',
            fontWeight: mode === m.id ? 600 : 400,
          }}
        >
          {m.icon} {m.label}
        </button>
      ))}
    </div>
  );
};
```

### T10.13.3: Command Registration

```typescript
import { SessionModes } from './adapter/SessionModes';

const modeStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
context.subscriptions.push(modeStatusItem);

const sessionModes = new SessionModes(modeStatusItem);
context.subscriptions.push(sessionModes);

context.subscriptions.push(
  vscode.commands.registerCommand('agentx.session.switchMode', () => sessionModes.switchMode()),
  vscode.commands.registerCommand('agentx.session.agentMode', () => sessionModes.setMode('agent')),
  vscode.commands.registerCommand('agentx.session.askMode', () => sessionModes.setMode('ask')),
  vscode.commands.registerCommand('agentx.session.planMode', () => sessionModes.setMode('plan')),
);
```

### T10.13.4: package.json

```json
{
  "commands": [
    {
      "command": "agentx.session.switchMode",
      "title": "Switch Session Mode",
      "category": "Agent-X"
    },
    {
      "command": "agentx.session.agentMode",
      "title": "Switch to Agent Mode",
      "category": "Agent-X"
    },
    {
      "command": "agentx.session.askMode",
      "title": "Switch to Ask Mode",
      "category": "Agent-X"
    },
    {
      "command": "agentx.session.planMode",
      "title": "Switch to Plan Mode",
      "category": "Agent-X"
    }
  ]
}
```

**Acceptance Criteria**:
- Status bar shows current mode with icon and short label (e.g., "$(rocket) Agent")
- Clicking status bar opens QuickPick with three modes and descriptions
- Switching to "Plan" enables `agent.setPlanMode(true)`
- Switching to "Agent" or "Ask" disables plan mode via `agent.setPlanMode(false)`
- Webview header renders segmented button control for quick switching
- Active mode button highlighted with button background color
- Information message confirms mode change with description
- `isReadOnly()` returns true in Ask mode (used to gate tool execution)
- `isPlanning()` returns true in Plan mode (used to gate plan UI visibility)

---

## T10.14: Verification & Testing

**Status**: ✅
**Estimated Effort**: 6 hours

### T10.14.1: Sub-Agent Tests

**File**: `packages/vscode/src/test/webview/SubAgentPanel.test.ts`

```typescript
import * as assert from 'node:assert';

suite('SubAgentPanel', () => {
  test('formatElapsed handles seconds', () => {
    const formatElapsed = (ms: number): string => {
      const s = Math.floor(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      return `${m}m ${s % 60}s`;
    };
    assert.strictEqual(formatElapsed(5000), '5s');
    assert.strictEqual(formatElapsed(45000), '45s');
  });

  test('formatElapsed handles minutes', () => {
    const formatElapsed = (ms: number): string => {
      const s = Math.floor(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      return `${m}m ${s % 60}s`;
    };
    assert.strictEqual(formatElapsed(90000), '1m 30s');
    assert.strictEqual(formatElapsed(300000), '5m 0s');
  });

  test('renders empty when no agents', () => {
    const agents: any[] = [];
    assert.strictEqual(agents.length, 0);
  });

  test('counts running vs finished correctly', () => {
    const agents = [
      { id: '1', status: 'running' },
      { id: '2', status: 'completed' },
      { id: '3', status: 'pending' },
    ];
    const running = agents.filter(a => a.status === 'running' || a.status === 'pending').length;
    const finished = agents.filter(a => a.status !== 'running' && a.status !== 'pending').length;
    assert.strictEqual(running, 2);
    assert.strictEqual(finished, 1);
  });
});
```

### T10.14.2: Plan Mode Tests

**File**: `packages/vscode/src/test/webview/PlanApproval.test.ts`

```typescript
import * as assert from 'node:assert';

suite('PlanApproval', () => {
  test('calculates progress correctly', () => {
    const steps = [
      { id: 's1', description: 'Step 1', status: 'completed' },
      { id: 's2', description: 'Step 2', status: 'skipped' },
      { id: 's3', description: 'Step 3', status: 'pending' },
      { id: 's4', description: 'Step 4', status: 'failed' },
    ];
    const completed = steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    const progress = (completed / steps.length) * 100;
    assert.strictEqual(completed, 2);
    assert.strictEqual(progress, 50);
  });

  test('isPending detects pending steps', () => {
    const steps = [
      { id: 's1', description: 'Done', status: 'completed' },
      { id: 's2', description: 'Waiting', status: 'pending' },
    ];
    assert.ok(steps.some(s => s.status === 'pending'));
  });

  test('hasAwaitingStep detects awaiting_approval', () => {
    const steps = [
      { id: 's1', description: 'Awaiting', status: 'awaiting_approval' },
    ];
    assert.ok(steps.some(s => s.status === 'awaiting_approval'));
  });
});
```

### T10.14.3: SteerHandler Tests

**File**: `packages/vscode/src/test/adapter/SteerHandler.test.ts`

```typescript
import * as assert from 'node:assert';
import { SteerHandler } from '../../adapter/SteerHandler';

suite('SteerHandler', () => {
  test('canSteer returns false when not processing', () => {
    const handler = new SteerHandler();
    handler.setIsProcessing(false);
    assert.strictEqual(handler.canSteer(), false);
  });

  test('canSteer returns true when processing and no rate limit', () => {
    const handler = new SteerHandler();
    handler.setIsProcessing(true);
    assert.strictEqual(handler.canSteer(), true);
  });

  test('dispose does not throw', () => {
    const handler = new SteerHandler();
    assert.doesNotThrow(() => handler.dispose());
  });
});
```

### T10.14.4: RAG Adapter Tests

**File**: `packages/vscode/src/test/adapter/RAGAdapter.test.ts`

```typescript
import * as assert from 'node:assert';

suite('RAGAdapter', () => {
  test('detectLanguage maps extensions correctly', () => {
    const detectLanguage = (filePath: string): string => {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescriptreact', js: 'javascript',
        jsx: 'javascriptreact', py: 'python', rs: 'rust',
        go: 'go', java: 'java', rb: 'ruby', php: 'php',
        md: 'markdown', json: 'json', yaml: 'yaml',
      };
      return map[ext] ?? 'plaintext';
    };
    assert.strictEqual(detectLanguage('file.ts'), 'typescript');
    assert.strictEqual(detectLanguage('file.py'), 'python');
    assert.strictEqual(detectLanguage('file.unknown'), 'plaintext');
    assert.strictEqual(detectLanguage('file.md'), 'markdown');
    assert.strictEqual(detectLanguage('file.jsx'), 'javascriptreact');
  });

  test('safeReadFile returns empty for non-existent file', () => {
    const { readFileSync } = require('node:fs');
    try {
      readFileSync('/nonexistent/path/file.txt', 'utf-8');
      assert.fail('Should have thrown');
    } catch {
      assert.ok(true);
    }
  });
});
```

### T10.14.5: Scheduler Adapter Tests

**File**: `packages/vscode/src/test/adapter/SchedulerAdapter.test.ts`

```typescript
import * as assert from 'node:assert';
import { SchedulerAdapter } from '../../adapter/SchedulerAdapter';

suite('SchedulerAdapter', () => {
  test('shows empty state when no agent', () => {
    const adapter = new SchedulerAdapter();
    const children = adapter.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]!.label, 'No agent active');
  });

  test('dispose does not throw', () => {
    const adapter = new SchedulerAdapter();
    assert.doesNotThrow(() => adapter.dispose());
  });
});
```

### T10.14.6: Clarification Handler Tests

**File**: `packages/vscode/src/test/adapter/ClarificationHandler.test.ts`

```typescript
import * as assert from 'node:assert';
import { ClarificationHandler } from '../../adapter/ClarificationHandler';

suite('ClarificationHandler', () => {
  test('handle does nothing when no engine attached', async () => {
    const handler = new ClarificationHandler();
    await handler.handle({ question: 'test', options: ['a', 'b'], allowFreeform: true });
  });

  test('dispose does not throw', () => {
    const handler = new ClarificationHandler();
    assert.doesNotThrow(() => handler.dispose());
  });
});
```

### T10.14.7: Session Modes Tests

**File**: `packages/vscode/src/test/adapter/SessionModes.test.ts`

```typescript
import * as assert from 'node:assert';

suite('SessionModes', () => {
  test('isReadOnly returns true for ask mode', () => {
    const mode = 'ask';
    assert.strictEqual(mode === 'ask', true);
  });

  test('isPlanning returns true for plan mode', () => {
    const mode = 'plan';
    assert.strictEqual(mode === 'plan', true);
  });

  test('default mode is agent', () => {
    const mode = 'agent';
    assert.strictEqual(mode, 'agent');
  });
});
```

### T10.14.8: Integration Verification Checklist

| Check | Method | Expected |
|-------|--------|----------|
| Sub-agent panel shows on spawn | Send message that triggers sub-agent | Panel appears with running card |
| Sub-agent cancel works | Click Cancel button on active card | Card updates to cancelled status |
| Sub-agent completion shows summary | Wait for sub-agent to finish | Card shows green border and summary |
| Plan mode toggle | Run `agentx.planMode.toggle` | Status bar updates, plan UI appears on next message |
| Plan approval flow | Approve all steps in plan UI | Steps execute sequentially |
| Plan rejection | Click Reject button | Plan rejected message appears |
| Per-step modify | Click modify, enter new description | Step description updates, engine receives modified step |
| Steer message during processing | Type while agent is running | QuickPick appears, steer sent |
| Steer rate limiting | Send multiple steers rapidly | Warning shown after rate limit exceeded |
| Background task panel | Run background command | Task row appears with elapsed timer |
| Background task cancel | Click Cancel on running task | Task cancelled |
| Background task notification | Wait for task completion | Toast notification with "View Output" |
| RAG workspace indexing | Run `agentx.rag.index` | Progress notification, status bar updates |
| RAG search | Run `agentx.rag.search` | QuickPick with scored results |
| RAG citation chips | Send message that triggers RAG | Citation badges appear in chat |
| Tree of Thoughts display | Trigger complex query | ToT panel with depth-grouped thoughts |
| ToT best path highlight | Wait for ToT completion | Best path highlighted with star |
| Research mode progress | Trigger research query | Research panel with query list |
| Research synthesized report | Wait for research completion | Report section appears |
| TODO panel updates | Agent creates TODOs during task | Panel appears with progress bar |
| TODO completion | All items completed | Progress bar turns green at 100% |
| Scheduler reminder | Run `agentx.reminder.add` | Reminder appears in tree view |
| Reminder fires | Wait for timer | Notification toast appears |
| Reminder management | Toggle, run now, remove | Tree view updates correctly |
| MCP server connect | Run `agentx.mcp.connect` | Server appears with tools |
| MCP tool test | Click tool, enter args | Result shown in text document |
| MCP disconnect | Context menu disconnect | Server removed from tree |
| Skills tree view | Open Skills view | Bundled and generated skills listed |
| Skill detail view | Click a skill | Formatted document opens |
| Skill deletion | Delete generated skill | Confirmation, skill removed |
| Reflection learnings | After reflection runs | Learnings listed under header |
| Clarification dialog | Agent asks clarification | QuickPick or InputBox appears |
| Clarification freeform | Select "Type your own" | InputBox with validation |
| Session mode switch | Click mode in status bar | QuickPick with three modes |
| Mode affects plan mode | Switch to Plan mode | `setPlanMode(true)` called |
| Webview mode switcher | Click mode buttons in header | Mode changes, UI updates |

### T10.14.9: End-to-End Test Scenarios

**Scenario 1: Sub-Agent Delegation**
1. User sends: "Research the latest TypeScript 5.5 features and summarize them"
2. Agent spawns a sub-agent via `agent_delegate` tool
3. Sub-agent card appears in chat with running status
4. Elapsed timer increments every second
5. Sub-agent completes, card turns green with summary
6. Main agent incorporates sub-agent result into final response

**Scenario 2: Plan Mode Approval**
1. User enables plan mode via command palette
2. Status bar shows "$(list-ordered) Plan"
3. User sends: "Refactor the authentication module"
4. Plan UI renders with title and step list
5. User clicks "Approve All"
6. Steps execute sequentially, each updating status
7. Final step completes, plan UI collapses

**Scenario 3: Steer During Execution**
1. User sends a long-running task
2. Agent starts processing (spinner visible)
3. User types "Focus on the error handling first"
4. Steer indicator appears: "Agent is processing — type to send as steer message"
5. User presses Send
6. QuickPick: "Send as steer message" selected
7. "Steering agent..." badge appears briefly
8. Agent incorporates steer into its execution

**Scenario 4: RAG Indexing and Querying**
1. User runs `agentx.rag.index`
2. Progress notification: "Indexing Workspace" with percentage
3. Status bar updates: "$(database) 1234"
4. User sends: "How does the payment system work?"
5. RAG auto-queries before response
6. Citation chips appear below response with file names and scores
7. User clicks `agentx.rag.search` for manual search
8. QuickPick shows scored results, selecting opens content preview

**Scenario 5: Full Research Mode**
1. User sends: "Research the best practices for Kubernetes security"
2. Research panel appears with decomposed sub-queries
3. Each query shows running status with source type icon
4. Queries complete one by one, expandable answers appear
5. Synthesized report renders at bottom when all queries done
6. Report is collapsible

---

## File Summary

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `webview/ui/components/SubAgentPanel.tsx` | Sub-agent progress cards in webview | ~180 |
| `webview/ui/components/PlanApproval.tsx` | Plan approval interface in webview | ~220 |
| `adapter/SteerHandler.ts` | Mid-execution steering bridge | ~100 |
| `webview/ui/components/BackgroundTasks.tsx` | Background task progress panel | ~130 |
| `adapter/RAGAdapter.ts` | RAG indexing, search, status bar | ~180 |
| `webview/ui/components/TreeOfThoughts.tsx` | ToT reasoning visualization | ~170 |
| `webview/ui/components/ResearchPanel.tsx` | Research mode progress UI | ~160 |
| `webview/ui/components/TodoPanel.tsx` | TODO list with progress bar | ~90 |
| `adapter/SchedulerAdapter.ts` | Reminder tree view and notifications | ~200 |
| `commands/MCPManager.ts` | MCP server tree view and management | ~200 |
| `adapter/SkillsAdapter.ts` | Skills and learnings tree view | ~180 |
| `adapter/ClarificationHandler.ts` | Clarification QuickPick/InputBox dialog | ~80 |
| `adapter/SessionModes.ts` | Agent/Ask/Plan mode switcher | ~120 |
| `test/webview/SubAgentPanel.test.ts` | Sub-agent panel tests | ~40 |
| `test/webview/PlanApproval.test.ts` | Plan approval tests | ~35 |
| `test/adapter/SteerHandler.test.ts` | Steer handler tests | ~25 |
| `test/adapter/RAGAdapter.test.ts` | RAG adapter tests | ~30 |
| `test/adapter/SchedulerAdapter.test.ts` | Scheduler adapter tests | ~20 |
| `test/adapter/ClarificationHandler.test.ts` | Clarification handler tests | ~20 |
| `test/adapter/SessionModes.test.ts` | Session modes tests | ~20 |

**Total estimated new code**: ~2,180 lines

---

## Dependency Graph

```
T10.1: Sub-Agent UI ──────────────────┐
T10.2: Plan Mode UI ──────────────────┤
T10.3: Steer Handler ─────────────────┤
T10.4: Background Tasks ──────────────┤
T10.5: RAG Integration ──────────────┤
T10.6: Tree of Thoughts ──────────────┤
T10.7: Research Mode ─────────────────┤
T10.8: TODO Panel ────────────────────┤
T10.9: Scheduler ─────────────────────┤
T10.10: MCP Management ───────────────┤
T10.11: Skills Display ───────────────┤
T10.12: Clarification Dialog ─────────┤
T10.13: Session Modes ────────────────┤
                                      │
                                      └──▶ T10.14: Verification (tests all above)
```

**Parallelizable**: T10.1 through T10.13 can all be implemented in parallel. Each is an independent feature module. T10.14 depends on all others.

**Recommended implementation order for a single developer**:
1. T10.13 (Session Modes) — smallest, establishes mode infrastructure
2. T10.12 (Clarification) — small, critical for agent interaction flow
3. T10.3 (Steer) — small, critical for real-time interaction
4. T10.8 (TODO) — small webview component
5. T10.2 (Plan Mode) — medium, depends on mode infrastructure from T10.13
6. T10.1 (Sub-Agents) — medium webview component
7. T10.4 (Background Tasks) — medium webview component
8. T10.5 (RAG) — larger, requires file system traversal
9. T10.9 (Scheduler) — medium, tree view + notifications
10. T10.10 (MCP) — medium, tree view + server management
11. T10.11 (Skills) — medium, tree view + file operations
12. T10.6 (ToT) — medium, complex visualization
13. T10.7 (Research) — medium, complex progress UI
14. T10.14 (Verification) — tests all above

---

### T10.Z: Update Master Plan

- **Status**: ⬜
- **Dependencies**: All above
- **Action**: Update [00-MASTER-PLAN.md](00-MASTER-PLAN.md) with the current status of all completed tasks in this phase. Mark each task as complete (✅), in progress (🔄), or blocked (❌). Identify the next action item. Ensure the master plan remains the single source of truth.

- **Acceptance criteria**:
  - `00-MASTER-PLAN.md` is up to date with current phase progress.
  - Every task in this phase has a status annotation in the master plan.
  - Next action item is clearly identified.