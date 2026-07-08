/**
 * CI helper: skip setup:extensions when the workflow already built pgvector/AGE.
 * Local dev / default: runs setup:extensions as usual.
 */
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.AGENTX_SKIP_EXTENSIONS === '1') {
  console.log('Skipping setup:extensions (AGENTX_SKIP_EXTENSIONS=1)');
  process.exit(0);
}

execSync('node scripts/setup-pgvector.mjs && node scripts/setup-age.mjs', {
  cwd: __dirname,
  stdio: 'inherit',
});
