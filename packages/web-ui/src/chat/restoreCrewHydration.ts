import type { CrewWorkerState } from '../components/CrewWorkerPanel';
import type { ChildSessionInfo, ChatMessage } from '../api';
import { sessions } from '../api';
import { repairStreamTextGlitches, stripToolNoise } from './utils';
import type { UIMessage } from '../chat/types';

interface CrewMeta {
  id: string;
  name?: string;
  callsign?: string;
  color?: string;
  icon?: string;
}

function parseCrewWorkerId(workerId: string): string | null {
  const match = workerId.match(/^crew-worker-(.+)-[a-f0-9]{8}$/i);
  return match?.[1] ?? null;
}

function parentMissingAssistantReply(messages: UIMessage[]): boolean {
  const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
  if (lastUserIdx < 0) return false;
  const userIndex = messages.length - 1 - lastUserIdx;
  return !messages.slice(userIndex + 1).some((m) => m.role === 'assistant' && (m.content?.trim() || m.parts?.length));
}

export async function hydrateCrewDeliverables(
  parentSessionId: string,
  messages: UIMessage[],
  crewList: CrewMeta[],
): Promise<{ messages: UIMessage[]; crewWorkers: CrewWorkerState[] }> {
  if (!parentMissingAssistantReply(messages)) {
    return { messages, crewWorkers: [] };
  }

  let children: ChildSessionInfo[] = [];
  try {
    children = await sessions.children(parentSessionId);
  } catch {
    return { messages, crewWorkers: [] };
  }

  const crewChildren = children.filter(
    (c) => c.id?.startsWith('crew-worker') || c.kind === 'crew_worker',
  );
  if (crewChildren.length === 0) {
    return { messages, crewWorkers: [] };
  }

  const injected: UIMessage[] = [...messages];
  const crewWorkers: CrewWorkerState[] = [];

  for (const child of crewChildren) {
    const childId = child.id;
    if (!childId) continue;

    let previewMessages: ChatMessage[] = [];
    try {
      const preview = await sessions.preview(childId);
      previewMessages = preview.messages ?? [];
    } catch {
      continue;
    }

    const assistant = [...previewMessages].reverse().find(
      (m) => m.role === 'assistant' && (m.content?.trim() || (m as { parts?: unknown[] }).parts?.length),
    );
    const crewId = parseCrewWorkerId(childId) ?? '';
    const crewMeta = crewList.find((c) => c.id === crewId);
    const callsign = crewMeta?.callsign ?? child.label ?? child.title ?? 'crew';

    crewWorkers.push({
      workerId: childId,
      crewId,
      crewName: child.title ?? crewMeta?.name ?? callsign,
      callsign,
      color: crewMeta?.color,
      status: 'done',
      message: assistant?.content ? 'Complete' : 'Done',
    });

    if (assistant?.content && parentMissingAssistantReply(injected)) {
      const text = repairStreamTextGlitches(stripToolNoise(assistant.content));
      injected.push({
        id: assistant.id ?? crypto.randomUUID(),
        role: 'assistant',
        content: text,
        streaming: false,
        parts: [{ type: 'text', id: crypto.randomUUID(), content: text }],
        crew: crewMeta
          ? {
            crewId,
            name: crewMeta.name ?? callsign,
            callsign,
            color: crewMeta.color,
            icon: crewMeta.icon,
          }
          : undefined,
      } as UIMessage);
    }
  }

  return { messages: injected, crewWorkers };
}
