# Agent-X

Agent-X is a pnpm workspace monorepo (an Electron AI-assistant desktop app). The core
dev-testable surface is the **web-api** (Express, `http://localhost:3333`) which serves the
built **web-ui** SPA and is backed by an **embedded PostgreSQL** (`127.0.0.1:3335`) with the
**pgvector** extension.

Packages: `shared`, `engine` (core logic), `web-api` (HTTP server), `web-ui` (React SPA),
`web-neuron` (3D graph viz, dev on `:3334`), `desktop` (Electron shell + embedded PostgreSQL).

## Cursor Cloud specific instructions

### Lint / typecheck / test / build
Use the root `package.json` scripts: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`,
`pnpm run build`.
- `pnpm run test` / `pnpm run build` first run `packages/engine/tests/platform-parity.test.ts`
  as a pre-check. Several engine tests intentionally shell out to `git`/`cargo`, so the test
  output contains scary-looking `fatal:`/`error:` lines that are expected — the run still passes.

### Running the app (development)
- `pnpm exec tsx dev-run.mjs` is the simplest full-stack runner: it boots embedded PostgreSQL
  on `127.0.0.1:3335` **and** the web-api on `http://localhost:3333` together, logging to
  `~/.local/share/agentx/logs/dev-run.log`. Ctrl-C stops both.
- `pnpm dev` runs only the web-api with hot reload (`tsx watch`); it does NOT start PostgreSQL.
  The engine falls back to `postgresql://agentx:agentx@127.0.0.1:3335/agentx` when
  `AGENTX_POSTGRES_CONNECTION_STRING` is unset, so PostgreSQL must already be running for it.
- `dev-run.mjs` runs the web-api from its **built** `dist` and serves the web-ui/web-neuron
  `dist` folders, so build the JS packages before running it (`pnpm run build`, or build
  `shared`, `engine`, `web-api`, `web-ui`, `web-neuron` individually in that order).
- First run has no user: open `http://localhost:3333` and create the root account in the setup
  wizard. The wizard's **Provider** step needs a reachable LLM (a cloud provider API key, or a
  running local Ollama/LM Studio) to finish — that is not required just to bring the environment
  up and verify auth/storage.
- `GET /api/health` is public; most other `/api/*` routes require login.

### Embedded PostgreSQL + pgvector (critical, non-obvious)
The web-api runs `CREATE EXTENSION vector` on startup, so the embedded PostgreSQL **must** ship a
compiled `pgvector`. It is built from source into the embedded-postgres native tree with
`pnpm --filter @agentx/desktop run setup:pgvector` (requires system packages `bison` and `flex`
plus the already-present `build-essential`/`gcc`/`make`/`python3`/`curl`/`git`). The compiled
artifacts land in `packages/desktop/node_modules/@embedded-postgres/linux-x64/native` and survive
`pnpm install`, so this only needs re-running if `node_modules` is wiped/rebuilt. If startup fails
with a `pgvector`/`CREATE EXTENSION vector` error, re-run that command.
- The **AGE** graph extension is not built; the app logs `AGE extension not available; using
  relational CTE graph engine` and works fine without it.
