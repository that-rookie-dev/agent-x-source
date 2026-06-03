import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChatMessage, StreamState, ToolState, PlanState, SubAgentState, ReasoningState, TodoItem, DiffState, BackgroundTask, ThoughtNodeState, ResearchQueryState } from '../App';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import { ToolCard } from './ToolCard';
import { PlanView } from './PlanView';
import { SubAgentPanel } from './SubAgentPanel';
import { ReasoningIndicator } from './ReasoningIndicator';
import { TodoPanel } from './TodoPanel';
import { DiffPreview } from './DiffPreview';
import { BackgroundTasks } from './BackgroundTasks';
import { TreeOfThoughts } from './TreeOfThoughts';
import { ResearchPanel } from './ResearchPanel';

interface ChatContainerProps {
  messages: ChatMessage[];
  stream: StreamState;
  tools: Map<string, ToolState>;
  plan: PlanState | null;
  subAgents: SubAgentState[];
  reasoning: ReasoningState;
  todos: TodoItem[];
  diff: DiffState | null;
  backgroundTasks: BackgroundTask[];
  treeOfThoughts: { thoughts: ThoughtNodeState[]; scores: Record<string, number>; bestThoughtId?: string; isComplete: boolean; problem: string } | null;
  research: ResearchQueryState[] | null;
  onPlanApprove: () => void;
  onPlanReject: () => void;
  onStepApprove: (stepId: string) => void;
  onStepSkip: (stepId: string) => void;
  onStepModify: (stepId: string, modification: string) => void;
  onSubAgentCancel: (agentId: string) => void;
  onBackgroundTaskCancel: (taskId: string) => void;
}

export function ChatContainer({
  messages, stream, tools, plan, subAgents, reasoning, todos, diff,
  backgroundTasks, treeOfThoughts, research,
  onPlanApprove, onPlanReject, onStepApprove, onStepSkip, onStepModify,
  onSubAgentCancel, onBackgroundTaskCancel,
}: ChatContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isNearBottomRef = useRef(true);

  const checkScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setShowScrollButton(!isNearBottomRef.current);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, stream.content, tools]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  const toolEntries = Array.from(tools.values());

  return (
    <div className="chat-container" ref={scrollRef} onScroll={checkScrollPosition}>
      <div className="chat-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {reasoning.active && <ReasoningIndicator text={reasoning.text} />}
        {toolEntries.map((tool) => <ToolCard key={tool.tool} tool={tool} />)}
        {treeOfThoughts && (
          <TreeOfThoughts
            thoughts={treeOfThoughts.thoughts}
            scores={treeOfThoughts.scores}
            bestThoughtId={treeOfThoughts.bestThoughtId}
            isComplete={treeOfThoughts.isComplete}
            problem={treeOfThoughts.problem}
          />
        )}
        {research && <ResearchPanel question={research[0]?.question ?? ''} queries={research} isComplete={research.every(q => q.status === 'complete')} />}
        {backgroundTasks && backgroundTasks.length > 0 && (
          <BackgroundTasks tasks={backgroundTasks} onCancel={onBackgroundTaskCancel} />
        )}
        <SubAgentPanel agents={subAgents} onCancel={onSubAgentCancel} />
        {plan && (
          <PlanView plan={plan} onApprove={onPlanApprove} onReject={onPlanReject}
            onStepApprove={onStepApprove} onStepSkip={onStepSkip} onStepModify={onStepModify} />
        )}
        {stream.active && <StreamingMessage content={stream.content} />}
        {diff && <DiffPreview diff={diff} />}
        {todos.length > 0 && <TodoPanel items={todos} />}
      </div>
      {showScrollButton && (
        <button className="scroll-to-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom">
          <span className="codicon codicon-chevron-down" />
        </button>
      )}
    </div>
  );
}
