#!/usr/bin/env node
const client = require('../lib/client');

async function run(){
  console.log('health...');
  console.log(await client.health());

  console.log('validate provider (sample lmstudio)');
  const v = await client.validateProvider({ provider: 'lmstudio', baseUrl: 'http://127.0.0.1:9999' });
  console.log(v);

  console.log('create crew');
  const crew = await client.createCrew('test-crew');
  console.log(crew);

  console.log('list crews');
  console.log(await client.listCrews());

  console.log('start chat');
  const c = await client.startChat();
  console.log(c);

  console.log('send a message (SSE will be streamed to clients, test posts OK)');
  console.log(await client.sendMessage(c.conversationId, 'hello world'));

  console.log('trace (if available):');
  console.log(await client.trace().catch(()=>'<no-trace>'));
}

run().catch(e=>{ console.error(e); process.exit(1); });
