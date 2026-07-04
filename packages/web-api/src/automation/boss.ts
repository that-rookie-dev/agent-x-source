import PgBoss from 'pg-boss';
import { getLogger } from '@agentx/shared';

const QUEUE_NAME = 'automation-run';

let boss: PgBoss | null = null;

export function getAutomationQueueName(): string {
  return QUEUE_NAME;
}

export async function startPgBoss(connectionString: string): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInHours: 23,
  });
  boss.on('error', (err) => {
    getLogger().error('PGBOSS', err instanceof Error ? err : String(err));
  });
  await boss.start();
  await boss.createQueue(QUEUE_NAME).catch(() => {});
  getLogger().info('PGBOSS', 'pg-boss started');
  return boss;
}

export function getPgBoss(): PgBoss | null {
  return boss;
}

export async function stopPgBoss(): Promise<void> {
  if (!boss) return;
  const instance = boss;
  boss = null;
  await instance.stop({ graceful: true, timeout: 10000 });
  getLogger().info('PGBOSS', 'pg-boss stopped');
}
