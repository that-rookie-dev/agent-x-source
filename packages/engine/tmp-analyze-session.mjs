import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://agentx:agentx@127.0.0.1:3335/agentx', max: 1 });
const sessionId = '17081846-2cb9-4927-ab7a-d758c8c15d6b';

async function main() {
  const { rows: messages } = await pool.query('SELECT id, role, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
  console.log('Total messages:', messages.length);
  for (const m of messages) {
    console.log('---');
    console.log('ROLE:', m.role);
    console.log('CONTENT:', (m.content || '').slice(0, 800));
  }

  const { rows: nodes } = await pool.query('SELECT id, label, category, content, session_id FROM memory_nodes WHERE session_id = $1', [sessionId]);
  console.log('\nTotal memory nodes for session:', nodes.length);
  for (const n of nodes) {
    console.log('NODE:', n.label, '|', n.category, '|', (n.content || '').slice(0, 200));
  }

  const { rows: edges } = await pool.query(`
    SELECT e.id, e.relationship_type, e.weight, sn.label AS source, tn.label AS target
    FROM memory_edges e
    INNER JOIN memory_nodes sn ON e.source_node_id = sn.id
    INNER JOIN memory_nodes tn ON e.target_node_id = tn.id
    WHERE sn.session_id = $1 OR tn.session_id = $1
  `, [sessionId]);
  console.log('\nTotal edges connected to session nodes:', edges.length);
  for (const e of edges) {
    console.log('EDGE:', e.source, '->', e.target, '|', e.relationship_type, '|', e.weight);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
