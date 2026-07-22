import { TemplateService, setTemplateService } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine, awaitEngineStorageReady } from '../engine.js';

let service: TemplateService | null = null;
let bootstrapPromise: Promise<TemplateService | null> | null = null;

export async function getTemplateService(): Promise<TemplateService | null> {
  if (service) return service;
  if (bootstrapPromise) return bootstrapPromise;

  await awaitEngineStorageReady();
  const pool = getEngine().pgPool;
  if (!pool) return null;

  const svc = new TemplateService({ pool });
  bootstrapPromise = Promise.resolve()
    .then(() => {
      service = svc;
      setTemplateService(svc);
      getLogger().info('TEMPLATES', 'Template library service bootstrapped');
      return svc;
    })
    .catch((err) => {
      getLogger().error(
        'TEMPLATES',
        `Failed to bootstrap: ${err instanceof Error ? err.message : String(err)}`,
      );
      bootstrapPromise = null;
      return null;
    });
  return bootstrapPromise;
}
