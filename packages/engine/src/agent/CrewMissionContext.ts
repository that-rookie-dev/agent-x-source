import { generateId } from '@agentx/shared';

export interface CrewWorkerArtifact {
  workerId: string;
  crewId: string;
  crewName: string;
  callsign: string;
  type: 'output' | 'file' | 'question' | 'blocker';
  content: string;
  timestamp: string;
}

export interface CrewInterMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

export type CrewMissionStatus = 'running' | 'retrying' | 'blocked' | 'complete' | 'failed';

export class CrewMissionContext {
  readonly missionId: string;
  readonly userMessage: string;
  readonly artifacts: CrewWorkerArtifact[] = [];
  readonly interMessages: CrewInterMessage[] = [];
  retryFeedback: string[] = [];
  clarificationAnswers: Array<{ crewId: string; question: string; answer: string }> = [];
  status: CrewMissionStatus = 'running';
  totalTokens = 0;
  private revision = 0;
  private memory: Map<string, string> = new Map();

  constructor(missionId: string, userMessage: string) {
    this.missionId = missionId;
    this.userMessage = userMessage;
  }

  get contextRevision(): number {
    return this.revision;
  }

  private bumpRevision(): void {
    this.revision += 1;
  }

  addArtifact(artifact: Omit<CrewWorkerArtifact, 'timestamp'>): void {
    this.artifacts.push({ ...artifact, timestamp: new Date().toISOString() });
    this.bumpRevision();
  }

  addInterMessage(from: string, to: string, content: string): void {
    this.interMessages.push({
      id: generateId(),
      from,
      to,
      content,
      timestamp: new Date().toISOString(),
    });
    this.bumpRevision();
  }

  setMemory(key: string, value: string): void {
    this.memory.set(key, value);
    this.bumpRevision();
  }

  addRetryFeedback(feedback: string): void {
    this.retryFeedback.push(feedback);
    this.bumpRevision();
  }

  addClarificationAnswer(entry: { crewId: string; question: string; answer: string }): void {
    this.clarificationAnswers.push(entry);
    this.bumpRevision();
  }

  getMemory(key: string): string | undefined {
    return this.memory.get(key);
  }

  getSharedContextBlock(): string {
    const lines: string[] = [`Mission: ${this.userMessage.slice(0, 500)}`];
    if (this.retryFeedback.length > 0) {
      lines.push('', 'Previous attempt feedback:', ...this.retryFeedback.map((f) => `- ${f}`));
    }
    if (this.artifacts.length > 0) {
      lines.push('', 'Team artifacts:');
      for (const a of this.artifacts.slice(-12)) {
        lines.push(`[${a.crewName}] (${a.type}): ${a.content.slice(0, 400)}`);
      }
    }
    if (this.interMessages.length > 0) {
      lines.push('', 'Inter-crew messages:');
      for (const m of this.interMessages.slice(-8)) {
        lines.push(`[${m.from} → ${m.to}]: ${m.content.slice(0, 300)}`);
      }
    }
    if (this.clarificationAnswers.length > 0) {
      lines.push('', 'Clarifications from Agent-X:');
      for (const c of this.clarificationAnswers.slice(-4)) {
        lines.push(`[${c.crewId}]: Q: ${c.question.slice(0, 120)} → A: ${c.answer.slice(0, 200)}`);
      }
    }
    return lines.join('\n');
  }

  toSnapshot(): Record<string, unknown> {
    return {
      missionId: this.missionId,
      userMessage: this.userMessage,
      status: this.status,
      totalTokens: this.totalTokens,
      artifacts: this.artifacts,
      interMessages: this.interMessages,
      clarificationAnswers: this.clarificationAnswers,
      retryFeedback: this.retryFeedback,
    };
  }
}
