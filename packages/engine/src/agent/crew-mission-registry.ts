import type { CrewMember } from './CrewOrchestrator.js';
import type { CrewMissionContext } from './CrewMissionContext.js';
import type { AgentEventBus } from '../EventBus.js';

export interface ActiveCrewMission {
  missionId: string;
  sessionId: string;
  context: CrewMissionContext;
  members: CrewMember[];
  eventBus: AgentEventBus;
  interCrewDelegate?: (fromId: string, toId: string, message: string) => Promise<string>;
}

const activeMissions = new Map<string, ActiveCrewMission>();
const workerToMission = new Map<string, string>();
const sessionMissionGuard = new Map<string, string>();

export const MAX_MISSION_WORKERS = 6;

export function beginMissionSession(sessionId: string, missionId: string): boolean {
  if (sessionMissionGuard.has(sessionId)) return false;
  sessionMissionGuard.set(sessionId, missionId);
  return true;
}

export function endMissionSession(sessionId: string, missionId: string): void {
  if (sessionMissionGuard.get(sessionId) === missionId) {
    sessionMissionGuard.delete(sessionId);
  }
}

export function isMissionInProgress(sessionId: string): boolean {
  return sessionMissionGuard.has(sessionId);
}

export function registerMission(mission: ActiveCrewMission): void {
  activeMissions.set(mission.missionId, mission);
}

export function unregisterMission(missionId: string): void {
  activeMissions.delete(missionId);
  for (const [workerId, mid] of workerToMission) {
    if (mid === missionId) workerToMission.delete(workerId);
  }
}

export function registerWorker(workerId: string, missionId: string): void {
  workerToMission.set(workerId, missionId);
}

export function unregisterWorker(workerId: string): void {
  workerToMission.delete(workerId);
}

export function getMissionByWorker(workerId: string): ActiveCrewMission | null {
  const missionId = workerToMission.get(workerId);
  if (!missionId) return null;
  return activeMissions.get(missionId) ?? null;
}

export function getMissionBySession(sessionId: string): ActiveCrewMission | null {
  for (const mission of activeMissions.values()) {
    if (mission.sessionId === sessionId) return mission;
  }
  const missionId = sessionMissionGuard.get(sessionId);
  if (!missionId) return null;
  return activeMissions.get(missionId) ?? null;
}

export function resolveCrewIdFromWorker(workerId: string): string | null {
  const mission = getMissionByWorker(workerId);
  if (!mission) return null;

  const uuidMatch = workerId.match(/^crew-worker-(.+)-[a-f0-9]{8}$/i);
  if (uuidMatch?.[1] && mission.members.some((m) => m.crew.id === uuidMatch[1])) {
    return uuidMatch[1];
  }

  const crewIdPart = mission.members.find((m) => workerId.includes(m.crew.id));
  return crewIdPart?.crew.id ?? null;
}
