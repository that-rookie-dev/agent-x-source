# Agent‑X Web UI — Quick User Guide

1. Web UI locations

- The Web UI is a separate app at `/web-ui` (development scaffold using Vite/React).
- The backend (API + static prototype) is in `source/packages/web-api` and is kept with the CLI.

2. Start the local web API (backend)

```bash
node source/packages/web-api/server.js
# backend listens on http://localhost:3333 and exposes the API endpoints
```

3. Start the Web UI (development)

```bash
cd web-ui
pnpm install
pnpm run dev
# open http://localhost:5173 (the dev UI will probe http://127.0.0.1:3333 for the Agent worker)
```

4. Health screen
- The Web UI probes the local Agent worker at `http://127.0.0.1:3333/api/health`. If the worker is not running the UI will show instructions to start it:
	- `agentx start` — if the CLI is installed system-wide
	- `pnpm --filter @agentx/cli run dev` — to start the CLI in development from the repository root
	- `node source/packages/web-api/server.js` — to start the lightweight backend only

5. Provider
- Enter LM Studio `baseUrl` (e.g. `http://127.0.0.1:9999`) and click `Validate and Save`.

4. Models
- Select a model and save it to persist in config. The UI will request `/api/models`.

5. Crews
- Create a crew, and switch to it (saved in `/api/config`).

6. Telegram
- Optionally save a Telegram token or skip this step.

7. Launch & Chat
- Click `Proceed to Chat` to open the chat page. Messages are sent to `/api/chat/message` and streamed back via Server-Sent Events (`/api/chat/stream`).

8. Trace
- If session tracing is enabled in the CLI, `/api/trace` will expose `/tmp/agentx-last-session.json` for debugging.

Notes
- The current implementation is a minimal, dependency-free prototype served from the agent. It can be upgraded to React+Vite quickly — let me know if you want that scaffolded next.
