/**
 * Remove markdown divider nodes (---, ***, ___) from the neural brain DB.
 *
 * Run (dry run — no deletes):
 *   pnpm -w exec tsx source/packages/engine/tests/cleanup-divider-nodes.ts --dry-run
 *
 * Run (delete):
 *   DATABASE_URL=postgresql://localhost:3335/agentx pnpm -w exec tsx source/packages/engine/tests/cleanup-divider-nodes.ts
 */
import { Pool } from 'pg';
import { DividerNodeCleaner } from '../src/neural/DividerNodeCleaner.js';

const dryRun = process.argv.includes('--dry-run');
const dbUrl = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'] ?? 'postgresql://localhost:3335/agentx';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: dbUrl });
  const cleaner = new DividerNodeCleaner(pool);

  console.log(`Divider node cleanup (${dryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log(`Database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);

  const matches = await cleaner.findDividerNodes();
  if (matches.length === 0) {
    console.log('No divider-only nodes found.');
    await pool.end();
    return;
  }

  console.log(`Found ${matches.length} candidate(s):`);
  for (const m of matches) {
    console.log(`  - ${m.id}  label=${JSON.stringify(m.label)}  content=${JSON.stringify(m.content.slice(0, 40))}`);
  }

  const result = await cleaner.cleanup({ dryRun });
  console.log('\nResult:', JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
