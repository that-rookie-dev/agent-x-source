import { setupWorkerListener } from './WorkerPool.js';
import { extractFromPath } from '../attachments/extract.js';

setupWorkerListener(async (task) => {
  const { path, mimeType } = (task.payload ?? {}) as { path?: string; mimeType?: string };
  if (!path || !mimeType) {
    throw new Error('Invalid extract task payload');
  }
  return extractFromPath(path, mimeType);
});
