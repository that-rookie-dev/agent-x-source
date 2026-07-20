/** Minimal pg client surface used for extension checks (avoids @types/pg dependency). */
export interface PgExtensionCheckClient {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type DbExtensionCheckStatus = 'ok' | 'warn' | 'fail';

export interface DbExtensionCheck {
  id: 'pgvector';
  label: string;
  status: DbExtensionCheckStatus;
  message: string;
  remediation?: string;
}

export interface DbExtensionCheckResult {
  checks: DbExtensionCheck[];
  vectorAvailable: boolean;
  vectorError?: string;
  extensionsCreated: boolean;
}

const PGVECTOR_REMEDIATION =
  'Install the pgvector extension on your PostgreSQL server (required for memory embeddings). '
  + 'Self-hosted: https://github.com/pgvector/pgvector — then run CREATE EXTENSION vector; as a superuser. '
  + 'Managed providers: enable pgvector in the dashboard (Neon, Supabase, RDS pgvector preview, etc.).';

export async function runDbExtensionChecks(client: PgExtensionCheckClient): Promise<DbExtensionCheckResult> {
  const checks: DbExtensionCheck[] = [];
  let vectorAvailable = false;
  let vectorError: string | undefined;

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    vectorAvailable = true;
    checks.push({
      id: 'pgvector',
      label: 'pgvector',
      status: 'ok',
      message: 'pgvector extension is installed (required for neural memory embeddings).',
    });
  } catch (e) {
    vectorError = e instanceof Error ? e.message : 'pgvector not available';
    checks.push({
      id: 'pgvector',
      label: 'pgvector',
      status: 'fail',
      message: vectorError,
      remediation: PGVECTOR_REMEDIATION,
    });
  }

  return {
    checks,
    vectorAvailable,
    vectorError,
    extensionsCreated: vectorAvailable,
  };
}
