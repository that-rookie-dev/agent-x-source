const BASE = process.env.AGENTX_BASE || 'http://localhost:3333';

async function health(){ return fetch(BASE + '/api/health').then(r=>r.json()); }
async function validateProvider(body){ return fetch(BASE + '/api/provider/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>({ ok:r.ok, status:r.status, body: await r.json()})); }
async function listModels(provider, baseUrl){ return fetch(BASE + `/api/models?provider=${encodeURIComponent(provider)}&baseUrl=${encodeURIComponent(baseUrl||'')}`).then(r=>r.json()); }
async function getConfig(){ return fetch(BASE + '/api/config').then(r=>r.json()); }
async function saveConfig(cfg){ return fetch(BASE + '/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)}).then(r=>r.json()); }
async function createCrew(name){ return fetch(BASE + '/api/crew',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}).then(r=>r.json()); }
async function listCrews(){ return fetch(BASE + '/api/crews').then(r=>r.json()); }
async function startChat(){ return fetch(BASE + '/api/chat/start',{method:'POST'}).then(r=>r.json()); }
async function sendMessage(conversationId, text){ return fetch(BASE + '/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId, text})}).then(r=>r.json()); }
async function trace(){ return fetch(BASE + '/api/trace').then(r=>r.text()); }

module.exports = { health, validateProvider, listModels, getConfig, saveConfig, createCrew, listCrews, startChat, sendMessage, trace };
