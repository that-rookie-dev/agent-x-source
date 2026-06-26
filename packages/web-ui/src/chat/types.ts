import type { ChatMessage } from '../api';
import type { TodoItem } from '../api';

export interface ToolCall {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  streamOutput?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: Record<string, unknown>;
}

export interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  toolCalls?: ToolCall[];
  kind?: 'sub_agent' | 'crew_worker';
}

import type { QuestionnaireRecord } from '@agentx/shared/browser';

export interface PartEntry {
  type: 'text' | 'tool' | 'subagent' | 'questionnaire' | 'crew_roster_picker' | 'deep_search';
  id: string;
  content?: string;
  tool?: ToolCall;
  agent?: SubAgent;
  questionnaire?: QuestionnaireRecord;
  crewRosterPicker?: import('../components/crew/CrewRosterPickerMessage').CrewRosterPickerRecord;
  deepSearch?: {
    bundle?: import('@agentx/shared/browser').DeepSearchResultBundle;
    progress?: import('@agentx/shared/browser').DeepSearchProgress;
    running?: boolean;
  };
}

export interface UIMessage extends ChatMessage {
  thinking?: string;
  thinkingStartedAt?: number;
  thinkingDoneAt?: number;
  toolCalls?: ToolCall[];
  subAgents?: SubAgent[];
  todos?: TodoItem[];
  streaming?: boolean;
  plan?: string[];
  attachments?: { name: string }[];
  turnTokens?: number;
  turnCostUsd?: number;
  crew?: {
    crewId: string;
    name: string;
    callsign: string;
    color?: string;
    icon?: string;
    confidence?: string;
    reasons?: string[];
  };
  parts?: PartEntry[];
  isModeChange?: { from: string; to: string };
  turnFeedback?: { rating: import('@agentx/shared/browser').TurnFeedbackRating };
}

export interface VisibleMessageItem {
  msg: UIMessage;
  isLastUser: boolean;
}
