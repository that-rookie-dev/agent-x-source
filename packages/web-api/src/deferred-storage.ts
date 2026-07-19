import type {
  StorageAdapter,
  StorableSession,
  StorableMessage,
  StorableTokenLog,
  Crew,
  CrewCreateInput,
} from '@agentx/shared';

const ERR = 'Storage is not provisioned yet. Complete the setup wizard storage step first.';

/**
 * Placeholder adapter used before the user chooses embedded vs cloud Postgres.
 * Allows the web API / wizard / auth to boot without a live database.
 */
export class DeferredStorageAdapter implements StorageAdapter {
  connect(): void {}
  disconnect(): void {}
  isConnected(): boolean {
    return false;
  }

  createSession(): StorableSession {
    throw new Error(ERR);
  }
  getSession(): StorableSession | null {
    return null;
  }
  updateSession(): void {}
  deleteSession(): void {}
  listSessions(): StorableSession[] {
    return [];
  }
  listRootSessions(): StorableSession[] {
    return [];
  }
  listChildSessions(): StorableSession[] {
    return [];
  }

  addMessage(): StorableMessage {
    throw new Error(ERR);
  }
  getMessages(): StorableMessage[] {
    return [];
  }
  deleteMessages(): void {}
  getMessageCount(): number {
    return 0;
  }

  addTokenLog(): void {}
  getTokenLogs(): StorableTokenLog[] {
    return [];
  }

  listCrews(): Crew[] {
    return [];
  }
  getCrew(): Crew | undefined {
    return undefined;
  }
  getDefaultCrew(): Crew | undefined {
    return undefined;
  }
  createCrew(_input: CrewCreateInput): Crew {
    throw new Error(ERR);
  }
  updateCrew(): Crew | null {
    return null;
  }
  deleteCrew(): void {}
  async flushWrites(): Promise<void> {}
  getPersona() {
    return null;
  }
  setPersona(): void {}

  clearAll(): void {}
  close(): void {}
}
