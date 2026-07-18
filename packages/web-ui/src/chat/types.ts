import type { ChatMessage } from '../api';
import type { TodoItem } from '../api';
import { upsertDeepSearchPart, type MessagePart } from '@agentx/shared/browser';

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

export interface PartEntry extends Record<string, unknown> {
  type: 'text' | 'tool' | 'subagent' | 'questionnaire' | 'crew_roster_picker' | 'deep_search' | 'chart';
  id: string;
  content?: string;
  tool?: ToolCall;
  agent?: SubAgent;
  questionnaire?: QuestionnaireRecord;
  crewRosterPicker?: import('../components/crew/CrewRosterPickerMessage').CrewRosterPickerRecord;
  /** Canonical ChartSpec JSON for structured chart parts. */
  chartJson?: string;
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
  attachments?: { id: string; name: string; mimeType?: string }[];
  turnTokens?: number;
  voiceTimings?: {
    sttMs: number;
    thinkingMs: number;
    ttsMs: number;
    totalMs: number;
    firstAudioMs: number;
  };
  /** True when the user message came from voice input. */
  voiceInput?: boolean;
  /** Hide spoken playback for this assistant turn. */
  voiceTextOnly?: boolean;
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
  turnFeedback?: { rating: import('@agentx/shared/browser').TurnFeedbackRating };
}

export interface VisibleMessageItem {
  msg: UIMessage;
  isLastUser: boolean;
}

export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** base64 data URL for preview / upload. */
  dataUrl: string;
  /** server attachment id once uploaded. */
  storageId?: string;
  /** true when upload has completed. */
  uploaded?: boolean;
}

export type ChatView = 'sessions' | 'chat';
export type SessionListTab = 'agent_x' | 'crew_private';

export function upsertDeepSearchPartEntry(parts: PartEntry[], payload: Parameters<typeof upsertDeepSearchPart>[1]): PartEntry[] {
  return upsertDeepSearchPart(parts as MessagePart[], payload) as PartEntry[];
}
