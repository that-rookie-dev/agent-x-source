# Agent-X Web API & Static UI (minimal)

This lightweight server provides a minimal HTTP API and static Web UI used for development and prototyping. It is intentionally dependency-free (uses Node built-ins) so it can be run without installing npm packages.

Run locally from the repository root:

```bash
node source/packages/web-api/server.js
# then open http://localhost:3333 in a browser
```

Endpoints (examples):
- `GET /api/health` — health
- `POST /api/provider/validate` — validate LM Studio baseUrl
- `GET /api/models` — list models (falls back to sample models)
- `GET/POST /api/config` — read/save configuration
- `GET /api/crews`, `POST /api/crew` — crew management
- `POST /api/chat/start`, `GET /api/chat/stream`, `POST /api/chat/message` — simple SSE-based chat
- `GET /api/trace` — reads `/tmp/agentx-last-session.json` if available

This scaffold implements the planned Web UI flows (provider, models, crews, telegram, launch, chat) as a minimal SPA. It is intended as a starting point — upgrade to a React+Vite app when ready.
