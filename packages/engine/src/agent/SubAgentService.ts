import { BackgroundTaskService } from './background/BackgroundTaskService.js';

export { BackgroundTaskService as SubAgentService } from './background/BackgroundTaskService.js';
export type { SubAgentRecord, BackgroundTaskRecord } from './background/background-task-types.js';

let subAgentServiceInstance: BackgroundTaskService | null = null;

export function getSubAgentServiceInstance(): BackgroundTaskService {
  if (!subAgentServiceInstance) {
    subAgentServiceInstance = new BackgroundTaskService();
  }
  return subAgentServiceInstance;
}

export function setSubAgentServiceInstance(service: BackgroundTaskService | null): void {
  subAgentServiceInstance = service;
}
