import { getLogger } from '@agentx/shared';

export class ErrorShield {
  wrap<T>(operation: () => T, fallback: T): T {
    try {
      return operation();
    } catch (error) {
      this.logError(error);
      return fallback;
    }
  }

  async wrapAsync<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logError(error);
      return fallback;
    }
  }

  logError(error: unknown): void {
    getLogger().error('ERROR_SHIELD', error);
  }
}
