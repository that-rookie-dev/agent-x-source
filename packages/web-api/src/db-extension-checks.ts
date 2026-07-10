/** Minimal pg client surface used for extension checks (avoids @types/pg dependency). */
export interface PgExtensionCheckClient {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type DbExtensionCheckStatus = 'ok' | 'warn' | 'fail';

export interface DbExtensionCheck {
  id: 'pgvector' | 'age';
  label: string;
  status: DbExtensionCheckStatus;
  message: string;
  remediation?: string;
}

export interface DbExtensionCheckResult {
  checks: DbExtensionCheck[];
  vectorAvailable: boolean;
  vectorError?: string;
  ageAvailable: boolean;
  ageError?: string;
  extensionsCreated: boolean;
}

const PGVECTOR_REMEDIATION =
  'Install the pgvector extension on your PostgreSQL server (required for memory embeddings). '
  + 'Self-hosted: https://github.com/pgvector/pgvector — then run CREATE EXTENSION vector; as a superuser. '
  + 'Managed providers: enable pgvector in the dashboard (Neon, Supabase, RDS pgvector preview, etc.).';

const AGE_REMEDIATION =
  'Apache AGE is optional. Agent-X will use a built-in SQL graph fallback — sessions, crews, and chat still work. '
  + 'For full graph performance on self-hosted PostgreSQL, build AGE from https://age.apache.org/ and run CREATE EXTENSION age;. '
  + 'Most managed clouds (RDS, Neon, Supabase, Azure) do not ship AGE; use Embedded PostgreSQL in Agent-X for bundled AGE (16 GB+ RAM).';

export async function runDbExtensionChecks(client: PgExtensionCheckClient): Promise<DbExtensionCheckResult> {
  const checks: DbExtensionCheck[] = [];
  let vectorAvailable = false;
  let vectorError: string | undefined;
  let ageAvailable = false;
  let ageError: string | undefined;
  let extensionsCreated = false;

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

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS age');
    ageAvailable = true;
    checks.push({
      id: 'age',
      label: 'Apache AGE',
      status: 'ok',
      message: 'Apache AGE graph extension is available (optional — faster graph walks).',
    });
  } catch (e) {
    ageError = e instanceof Error ? e.message : 'AGE not available';
    try {
      const { rows } = await client.query(
        `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'age') AS available`,
      );
      if (rows[0]?.available !== true) {
        ageError = ageError || 'extension "age" is not available on this server';
      }
    } catch {
      /* keep original error */
    }
    checks.push({
      id: 'age',
      label: 'Apache AGE',
      status: 'warn',
      message: ageError,
      remediation: AGE_REMEDIATION,
    });
  }

  try {
    const { rows } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') AS available`,
    );
    ageAvailable = rows[0]?.available === true;
    if (ageAvailable) {
      const ageCheck = checks.find((c) => c.id === 'age');
      if (ageCheck) {
        ageCheck.status = 'ok';
        ageCheck.message = 'Apache AGE graph extension is available (optional — faster graph walks).';
        delete ageCheck.remediation;
      }
    }
  } catch {
    /* detect only */
  }

  extensionsCreated = vectorAvailable || ageAvailable;

  return {
    checks,
    vectorAvailable,
    vectorError,
    ageAvailable,
    ageError: ageAvailable ? undefined : ageError,
    extensionsCreated,
  };
}
