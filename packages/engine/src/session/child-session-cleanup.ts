import type { Pool } from 'pg';

/** Remove child_sessions index rows whose session rows no longer exist. */
export async function purgeOrphanChildSessionsPg(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      DELETE FROM child_sessions c
      WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = c.id)
         OR NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = c.parent_session_id)
    `);
  } catch {
    /* table may not exist yet */
  }
}
