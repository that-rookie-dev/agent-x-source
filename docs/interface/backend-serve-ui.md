Backend UI serving options

By default the Agent-X backend (CLI/daemon) does NOT serve a static UI. The frontend is a separate app located at `/web-ui`.

If you want the backend to serve the frontend for local testing, two options are available:

- Proxy to the dev server (recommended while developing):

  ```bash
  AGENTX_SERVE_UI=proxy AGENTX_UI_PROXY_URL=http://localhost:5173 node source/packages/web-api/server.js
  # Run the React dev server in the web-ui folder:
  cd web-ui
  pnpm install
  pnpm run dev
  ```

- Serve the built static files (useful for testing production build):

  ```bash
  # Build the web-ui into web-ui/dist
  cd web-ui
  pnpm install
  pnpm run build

  # Serve the built files from the backend
  AGENTX_SERVE_UI=static node source/packages/web-api/server.js
  # open http://localhost:3333
  ```

If no `AGENTX_SERVE_UI` is set, the backend exposes only the API endpoints and will not serve the UI.
